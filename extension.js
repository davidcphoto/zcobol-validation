// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// Diagnostic collection for unused variable warnings
let diagnosticCollection;

/**
 * Verifica se o documento é um ficheiro COBOL
 * @param {vscode.TextDocument} document
 * @returns {boolean}
 */
function isCobolFile(document) {
	const cobolExtensions = ['.cbl', '.cob', '.cobol', '.cpy'];
	const fileName = document.fileName.toLowerCase();
	return cobolExtensions.some(ext => fileName.endsWith(ext)) ||
	       document.languageId === 'cobol';
}

/**
 * Verifica se uma variável é um grupo (não tem PIC e tem sub-variáveis)
 * @param {string[]} lines
 * @param {number} varLine
 * @param {number} varLevel
 * @returns {boolean}
 */
function isGroupVariable(lines, varLine, varLevel) {
	const currentLine = lines[varLine];

	// Se a linha tem PIC, VALUE, ou USAGE, não é um grupo
	if (/\bPIC\b|\bPICTURE\b|\bVALUE\b|\bUSAGE\b/i.test(currentLine)) {
		return false;
	}

	// Verifica se a próxima linha (ou linhas) tem uma variável de nível maior
	for (let i = varLine + 1; i < lines.length; i++) {
		const line = lines[i];

		// Se encontrar outra divisão, para
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			break;
		}

		// Procura declaração de variável
		const nextVarMatch = line.match(/^\s{6,}\s*(01|0[2-9]|[1-4][0-9]|77|88)\s+/i);
		if (nextVarMatch) {
			const nextLevel = parseInt(nextVarMatch[1]);

			// Se o nível é maior, é uma sub-variável, então a variável atual é um grupo
			if (nextLevel > varLevel) {
				return true;
			}

			// Se o nível é igual ou menor, não há sub-variáveis
			if (nextLevel <= varLevel) {
				return false;
			}
		}
	}

	return false;
}

/**
 * Extrai variáveis declaradas no código COBOL
 * @param {string} text
 * @returns {Map<string, {line: number, column: number, isLinkage: boolean}>}
 */
function extractDeclaredVariables(text) {
	const variables = new Map();
	const lines = text.split('\n');

	let inDataDivision = false;
	let inLinkageSection = false;
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];


		// Detecta início da DATA DIVISION
		if (/^\s*DATA\s+DIVISION/i.test(line)) {
			inDataDivision = true;
			inProcedureDivision = false;
			continue;
		}

		// Detecta início da LINKAGE SECTION
		if (/^\s*LINKAGE\s+SECTION/i.test(line)) {
			inLinkageSection = true;
			continue;
		}

		// Detecta início de outras seções (sai da LINKAGE SECTION)
		if (inDataDivision && /^\s*(WORKING-STORAGE|FILE|LOCAL-STORAGE|SCREEN|REPORT)\s+SECTION/i.test(line)) {
			inLinkageSection = false;
			continue;
		}

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inDataDivision = false;
			inLinkageSection = false;
			inProcedureDivision = true;
			continue;
		}

		// Se estamos na DATA DIVISION, procura declarações de variáveis
		if (inDataDivision && !inProcedureDivision) {
			// Procura por declarações de variáveis (nível 01-49, 77, 88)
			const varMatch = line.match(/^\s{6,}\s*(01|0[2-9]|[1-4][0-9]|77)\s+([A-Z0-9][\w-]*)/i);
			if (varMatch) {
				const varLevel = parseInt(varMatch[1]);
				const varName = varMatch[2].toUpperCase();

				// Ignora FILLER e palavras reservadas comuns
				if (varName !== 'FILLER' && !varName.startsWith('FILLER-')) {
					// Ignora variáveis de grupo (que não têm PIC e têm sub-variáveis)
					if (!isGroupVariable(lines, i, varLevel)) {
						const column = line.indexOf(varMatch[2]);
						variables.set(varName, {
							line: i,
							column: column,
							isLinkage: inLinkageSection
						});
					} else {
						console.log(`Variável ${varName} é um grupo - ignorada`);
					}
				}
			}
		}
	}

	return variables;
}

/**
 * Verifica se uma variável é utilizada no código
 * @param {string} text
 * @param {string} varName
 * @param {boolean} isLinkage - Se true, verifica uso também na LINKAGE SECTION
 * @returns {boolean}
 */
function isVariableUsed(text, varName, isLinkage = false) {
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let inLinkageSection = false;
	let inDataDivision = false;
	let procedureDivisionStartLine = -1;
	let linkageSectionStartLine = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da DATA DIVISION
		if (/^\s*DATA\s+DIVISION/i.test(line)) {
			inDataDivision = true;
			inProcedureDivision = false;
			continue;
		}

		// Detecta início da LINKAGE SECTION
		if (/^\s*LINKAGE\s+SECTION/i.test(line)) {
			inLinkageSection = true;
			linkageSectionStartLine = i;
			continue;
		}

		// Detecta início de outras seções (sai da LINKAGE SECTION)
		if (inDataDivision && /^\s*(WORKING-STORAGE|FILE|LOCAL-STORAGE|SCREEN|REPORT)\s+SECTION/i.test(line)) {
			inLinkageSection = false;
			continue;
		}

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			inLinkageSection = false;
			inDataDivision = false;
			procedureDivisionStartLine = i;
			console.log(`PROCEDURE DIVISION encontrada na linha ${i}`);
			continue;
		}

		// Procura uso da variável na PROCEDURE DIVISION
		if (inProcedureDivision && i > procedureDivisionStartLine) {
			// Ignora comentários
			if (line.length > 6 && line[6] === '*') {
				continue;
			}

			// Procura a variável como palavra completa (não parte de outra palavra)
			const regex = new RegExp('\\b' + varName.replace(/-/g, '\\-') + '\\b', 'i');
			if (regex.test(line)) {
				console.log(`Variável ${varName} encontrada na linha ${i}: ${line.trim()}`);
				return true;
			}
		}

		// Se é variável da LINKAGE SECTION, verifica uso também na própria LINKAGE SECTION
		if (isLinkage && inLinkageSection && i > linkageSectionStartLine) {
			// Ignora comentários
			if (line.length > 6 && line[6] === '*') {
				continue;
			}

			// Ignora a linha de declaração da própria variável
			const isDeclaration = line.match(new RegExp('^\\s{6,}\\s*(01|0[2-9]|[1-4][0-9]|77)\\s+' + varName.replace(/-/g, '\\-') + '\\b', 'i'));
			if (isDeclaration) {
				continue;
			}

			// Procura a variável como palavra completa (não parte de outra palavra)
			const regex = new RegExp('\\b' + varName.replace(/-/g, '\\-') + '\\b', 'i');
			if (regex.test(line)) {
				console.log(`Variável ${varName} encontrada na LINKAGE SECTION na linha ${i}: ${line.trim()}`);
				return true;
			}
		}
	}

	return false;
}

/**
 * Verifica displays não protegidos (fora de blocos IF)
 * @param {string} text
 * @returns {Array<{line: number, column: number, length: number}>}
 */
function findUnprotectedDisplays(text) {
	const displays = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let ifNestingLevel = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		// Detecta início de IF
		if (/^\s*IF\s+/i.test(line.substring(6))) {
			ifNestingLevel++;
			console.log(`IF encontrado na linha ${i}, nível: ${ifNestingLevel}`);
		}

		// Detecta fim de IF
		if (/^\s*END-IF/i.test(line.substring(6))) {
			if (ifNestingLevel > 0) {
				ifNestingLevel--;
			}
			console.log(`END-IF encontrado na linha ${i}, nível: ${ifNestingLevel}`);
		}

		// Detecta DISPLAY fora de blocos IF
		const displayMatch = line.substring(6).match(/^\s*(DISPLAY\s+)/i);
		if (displayMatch && ifNestingLevel === 0) {
			const column = line.indexOf(displayMatch[1]);
			displays.push({
				line: i,
				column: column,
				length: displayMatch[1].trim().length
			});
			console.log(`DISPLAY não protegido encontrado na linha ${i}`);
		}
	}

	return displays;
}

/**
 * Verifica uso de símbolos (<, >, =) em condições IF e WHEN
 * @param {string} text
 * @param {boolean} useShortForm - Se true, usa LESS OR EQUAL e GREATER OR EQUAL em vez das formas longas
 * @returns {Array<{line: number, column: number, length: number, operator: string, replacement: string}>}
 */
function findSymbolicOperatorsInIf(text, useShortForm = false) {
	const operators = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		const lineContent = line.substring(6);

		// Procura linhas com IF ou WHEN
		if (/^\s*(IF|WHEN)\s+/i.test(lineContent)) {
			// Procura símbolos <, >, = na condição
			// Usa regex para encontrar os símbolos, evitando falsas deteções em strings
			const symbolPatterns = [
				{ regex: /<>/g, operator: '<>', replacement: 'NOT EQUAL' },
				{ regex: />=/g, operator: '>=', replacement: useShortForm ? 'GREATER OR EQUAL' : 'GREATER THAN OR EQUAL' },
				{ regex: /<=/g, operator: '<=', replacement: useShortForm ? 'LESS OR EQUAL' : 'LESS THAN OR EQUAL' },
				{ regex: /(?<![<>])>(?!=)/g, operator: '>', replacement: 'GREATER THAN' },
				{ regex: /(?<![<>])<(?![=>])/g, operator: '<', replacement: 'LESS THAN' },
				{ regex: /(?<![<>])=(?!=)/g, operator: '=', replacement: 'EQUAL' }
			];

			// Coleta todas as linhas que fazem parte da condição
			const conditionLines = [{ lineIndex: i, content: lineContent, fullLine: line }];
			let currentIndex = i;

			// Verifica se a condição continua nas próximas linhas
			while (currentIndex < lines.length - 1) {
				const currentContent = conditionLines[conditionLines.length - 1].content.trim();

				// Se termina com ponto, fim da condição
				if (currentContent.endsWith('.')) {
					break;
				}

				// Se contém THEN (explícito), as próximas linhas não são parte da condição
				if (/\bTHEN\b/i.test(currentContent)) {
					break;
				}

				// Se termina com palavra-chave que indica fim da condição
				if (/\b(ELSE|END-IF|END-EVALUATE)\s*$/i.test(currentContent)) {
					break;
				}

				// Verifica próxima linha
				const nextIndex = currentIndex + 1;
				const nextLine = lines[nextIndex];

				// Se é comentário, pula mas continua verificando
				if (nextLine.length > 6 && nextLine[6] === '*') {
					currentIndex++;
					continue;
				}

				const nextLineContent = nextLine.substring(6);

				// Se a próxima linha inicia um novo comando ou parágrafo, fim da condição
				if (/^\s{0,3}[A-Z0-9][A-Z0-9-]*\s*\./i.test(nextLineContent) ||
				    /^\s*(IF|WHEN|MOVE|DISPLAY|PERFORM|COMPUTE|ADD|SUBTRACT|MULTIPLY|DIVIDE|EVALUATE|END-IF|END-EVALUATE|ELSE|CONTINUE|STOP|EXIT|GOBACK|GO\s+TO)\b/i.test(nextLineContent)) {
					break;
				}

				// Adiciona linha de continuação da condição
				conditionLines.push({ lineIndex: nextIndex, content: nextLineContent, fullLine: nextLine });
				currentIndex++;
			}

			// Processa cada linha da condição
			for (const { lineIndex, content } of conditionLines) {
				// Remove strings literais da linha para evitar detetar símbolos dentro de strings
				let lineWithoutStrings = content;
				const stringMatches = [...content.matchAll(/(['"])([^'"]*?)\1/g)];
				for (const match of stringMatches) {
					lineWithoutStrings = lineWithoutStrings.replace(match[0], '""');
				}

				// Procura cada tipo de operador
				for (const pattern of symbolPatterns) {
					const matches = [...lineWithoutStrings.matchAll(pattern.regex)];
					for (const match of matches) {
						const matchIndex = match.index;
						const column = 6 + matchIndex;
						operators.push({
							line: lineIndex,
							column: column,
							length: pattern.operator.length,
							operator: pattern.operator,
							replacement: pattern.replacement
						});
						console.log(`Operador simbólico '${pattern.operator}' encontrado na linha ${lineIndex}`);
					}
				}
			}

			// Avança o índice principal para não reprocessar linhas já verificadas
			i = currentIndex;
		}
	}

	return operators;
}

/**
 * Verifica comandos GO TO no código
 * @param {string} text
 * @returns {Array<{line: number, column: number, length: number, target: string}>}
 */
function findGoToStatements(text) {
	const gotos = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		// Detecta GO TO (com ou sem espaço: "GO TO" ou "GOTO")
		const gotoMatch = line.substring(6).match(/^\s*(GO\s*TO\s+([A-Z0-9][\w-]*))/i);
		if (gotoMatch) {
			const column = line.indexOf(gotoMatch[1]);
			const target = gotoMatch[2] || '';
			gotos.push({
				line: i,
				column: column,
				length: gotoMatch[1].trim().length,
				target: target
			});
			console.log(`GO TO encontrado na linha ${i} para ${target}`);
		}
	}

	return gotos;
}

/**
 * Verifica IFs sem END-IF correspondente
 * @param {string} text
 * @returns {Array<{line: number, column: number, length: number}>}
 */
function findUnmatchedIfs(text) {
	const lines = text.split('\n');
	let inProcedureDivision = false;
	const ifStack = []; // Stack para rastrear IFs

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		const lineContent = line.substring(6);

		// Detecta IF (mas não END-IF)
		const ifMatch = lineContent.match(/^\s*(IF\s+)/i);
		if (ifMatch && !/^\s*END-IF/i.test(lineContent)) {
			const column = line.indexOf(ifMatch[1]);
			ifStack.push({
				line: i,
				column: column,
				length: ifMatch[1].trim().length
			});
			console.log(`IF encontrado na linha ${i}, stack size: ${ifStack.length}`);
		}

		// Detecta END-IF
		if (/^\s*END-IF/i.test(lineContent)) {
			if (ifStack.length > 0) {
				ifStack.pop(); // Remove o IF correspondente
				console.log(`END-IF encontrado na linha ${i}, stack size: ${ifStack.length}`);
			}
		}
	}

	// IFs que sobraram no stack não têm END-IF correspondente
	console.log(`IFs sem END-IF: ${ifStack.length}`);
	return ifStack;
}

/**
 * Verifica IFs sem ELSE correspondente
 * @param {string} text
 * @returns {Array<{line: number, column: number, length: number}>}
 */
function findIfsWithoutElse(text) {
	const ifsWithoutElse = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		const lineContent = line.substring(6);

		// Detecta IF (mas não END-IF)
		const ifMatch = lineContent.match(/^\s*(IF\s+)/i);
		if (ifMatch && !/^\s*END-IF/i.test(lineContent)) {
			const column = line.indexOf(ifMatch[1]);
			const ifInfo = {
				line: i,
				column: column,
				length: ifMatch[1].trim().length
			};

			// Procura ELSE ou END-IF correspondente
			let nestingLevel = 1;
			let hasElse = false;

			for (let j = i + 1; j < lines.length; j++) {
				const nextLine = lines[j];

				// Ignora comentários
				if (nextLine.length > 6 && nextLine[6] === '*') {
					continue;
				}

				const nextLineContent = nextLine.substring(6);

				// Detecta novo IF aninhado
				if (/^\s*IF\s+/i.test(nextLineContent) && !/^\s*END-IF/i.test(nextLineContent)) {
					nestingLevel++;
				}

				// Detecta ELSE no mesmo nível
				if (/^\s*ELSE\b/i.test(nextLineContent) && nestingLevel === 1) {
					hasElse = true;
					break;
				}

				// Detecta END-IF
				if (/^\s*END-IF/i.test(nextLineContent)) {
					nestingLevel--;
					if (nestingLevel === 0) {
						// Chegou ao fim deste IF sem encontrar ELSE
						break;
					}
				}
			}

			if (!hasElse) {
				ifsWithoutElse.push(ifInfo);
				console.log(`IF sem ELSE encontrado na linha ${i}`);
			}
		}
	}

	return ifsWithoutElse;
}

/**
 * Verifica EVALUATE sem WHEN OTHER
 * @param {string} text
 * @returns {Array<{line: number, column: number, length: number}>}
 */
function findEvaluatesWithoutWhenOther(text) {
	const evaluatesWithoutWhenOther = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		const lineContent = line.substring(6);

		// Detecta EVALUATE
		const evaluateMatch = lineContent.match(/^\s*(EVALUATE\s+)/i);
		if (evaluateMatch) {
			const column = line.indexOf(evaluateMatch[1]);
			const evaluateInfo = {
				line: i,
				column: column,
				length: evaluateMatch[1].trim().length
			};

			// Procura WHEN OTHER ou END-EVALUATE correspondente
			let nestingLevel = 1;
			let hasWhenOther = false;

			for (let j = i + 1; j < lines.length; j++) {
				const nextLine = lines[j];

				// Ignora comentários
				if (nextLine.length > 6 && nextLine[6] === '*') {
					continue;
				}

				const nextLineContent = nextLine.substring(6);

				// Detecta EVALUATE aninhado
				if (/^\s*EVALUATE\s+/i.test(nextLineContent)) {
					nestingLevel++;
				}

				// Detecta WHEN OTHER no mesmo nível
				if (/^\s*WHEN\s+OTHER\b/i.test(nextLineContent) && nestingLevel === 1) {
					hasWhenOther = true;
					break;
				}

				// Detecta END-EVALUATE
				if (/^\s*END-EVALUATE/i.test(nextLineContent)) {
					nestingLevel--;
					if (nestingLevel === 0) {
						// Chegou ao fim deste EVALUATE sem encontrar WHEN OTHER
						break;
					}
				}
			}

			if (!hasWhenOther) {
				evaluatesWithoutWhenOther.push(evaluateInfo);
				console.log(`EVALUATE sem WHEN OTHER encontrado na linha ${i}`);
			}
		}
	}

	return evaluatesWithoutWhenOther;
}

/**
 * Verifica código em minúsculas (lower case)
 * @param {string} text
 * @returns {Array<{line: number, column: number, length: number, word: string}>}
 */
function findLowerCaseCode(text) {
	const lowerCaseCode = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		const lineContent = line.substring(6);

		// Remove strings literais da linha para não validar o conteúdo delas
		let lineWithoutStrings = lineContent;
		const stringMatches = [...lineContent.matchAll(/(['"])([^'"]*?)\1/g)];
		const stringRanges = [];
		for (const match of stringMatches) {
			const start = match.index;
			const end = match.index + match[0].length;
			stringRanges.push({ start, end });
			lineWithoutStrings = lineWithoutStrings.replace(match[0], '"'.repeat(match[0].length));
		}

		// Procura por todas as palavras (qualquer combinação de letras, números e hífens)
		// Palavras são sequências de letras (maiúsculas ou minúsculas), números e hífens
		const wordMatches = [...lineWithoutStrings.matchAll(/\b[A-Za-z][A-Za-z0-9-]*\b/g)];

		for (const match of wordMatches) {
			const word = match[0];
			const matchIndex = match.index;

			// Verifica se a palavra está dentro de uma string literal
			const isInString = stringRanges.some(range => matchIndex >= range.start && matchIndex < range.end);
			if (isInString) {
				continue;
			}

			// Se tem pelo menos uma letra minúscula, adiciona ao resultado
			if (/[a-z]/.test(word)) {
				const column = 6 + matchIndex;
				lowerCaseCode.push({
					line: i,
					column: column,
					length: word.length,
					word: word
				});
				console.log(`Código em minúsculas encontrado na linha ${i}: ${word}`);
			}
		}
	}

	return lowerCaseCode;
}

/**
 * Extrai declarações de ficheiros no código COBOL (SELECT statements)
 * @param {string} text
 * @returns {Map<string, {line: number, column: number}>}
 */
function extractFileDeclarations(text) {
	const files = new Map();
	const lines = text.split('\n');
	let inFileControl = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da FILE-CONTROL
		if (/^\s*FILE-CONTROL/i.test(line)) {
			inFileControl = true;
			console.log(`FILE-CONTROL encontrado na linha ${i}`);
			continue;
		}

		// Detecta fim da FILE-CONTROL (quando encontra outra seção ou divisão)
		if (inFileControl && /^\s*(I-O-CONTROL|DATA\s+DIVISION|PROCEDURE\s+DIVISION)/i.test(line)) {
			inFileControl = false;
			console.log(`Fim de FILE-CONTROL na linha ${i}`);
			continue;
		}

		// Se estamos na FILE-CONTROL, procura declarações SELECT
		if (inFileControl) {
			// Ignora comentários
			if (line.length > 6 && line[6] === '*') {
				continue;
			}

			// Procura por SELECT <nome-ficheiro>
			const selectMatch = line.match(/^\s*SELECT\s+([A-Z0-9][\w-]*)/i);
			if (selectMatch) {
				const fileName = selectMatch[1].toUpperCase();
				const column = line.indexOf(selectMatch[1]);
				files.set(fileName, {
					line: i,
					column: column
				});
				console.log(`Ficheiro declarado: ${fileName} na linha ${i}`);
			}
		}
	}

	return files;
}

/**
 * Verifica operações de ficheiros (OPEN, CLOSE, READ, WRITE) no código
 * @param {string} text
 * @param {string} fileName - Nome do ficheiro a verificar
 * @returns {{hasOpen: boolean, hasClose: boolean, hasReadOrWrite: boolean}}
 */
function hasFileOperations(text, fileName) {
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let hasOpen = false;
	let hasClose = false;
	let hasReadOrWrite = false;

	// Escapar hífens no nome do ficheiro para usar em regex
	const escapedFileName = fileName.replace(/-/g, '\\-');
	const fileNameRegex = new RegExp('\\b' + escapedFileName + '\\b', 'i');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		const lineContent = line.substring(6);

		// Verifica OPEN com o nome do ficheiro
		if (/^\s*OPEN\s+(INPUT|OUTPUT|I-O|EXTEND)/i.test(lineContent)) {
			if (fileNameRegex.test(lineContent)) {
				hasOpen = true;
				console.log(`OPEN encontrado para ${fileName} na linha ${i}`);
			}
		}

		// Verifica CLOSE com o nome do ficheiro
		if (/^\s*CLOSE\s+/i.test(lineContent)) {
			if (fileNameRegex.test(lineContent)) {
				hasClose = true;
				console.log(`CLOSE encontrado para ${fileName} na linha ${i}`);
			}
		}

		// Verifica READ com o nome do ficheiro
		if (/^\s*READ\s+/i.test(lineContent)) {
			if (fileNameRegex.test(lineContent)) {
				hasReadOrWrite = true;
				console.log(`READ encontrado para ${fileName} na linha ${i}`);
			}
		}

		// Verifica WRITE com o nome do ficheiro ou com o record associado
		// Em COBOL, WRITE usa o nome do record, não o ficheiro diretamente
		// Mas podemos verificar se há algum WRITE no código quando há um ficheiro OUTPUT/EXTEND
		if (/^\s*WRITE\s+/i.test(lineContent)) {
			// Para simplificar, marcamos como tendo WRITE se encontramos qualquer WRITE
			// Uma validação mais rigorosa precisaria rastrear o FD e os records
			if (fileNameRegex.test(lineContent)) {
				hasReadOrWrite = true;
				console.log(`WRITE encontrado para ${fileName} na linha ${i}`);
			}
		}
	}

	return { hasOpen, hasClose, hasReadOrWrite };
}

/**
 * Verifica ficheiros sem operações completas (OPEN, CLOSE, READ/WRITE)
 * @param {string} text
 * @returns {Array<{fileName: string, line: number, column: number, missing: string[]}>}
 */
function findFilesWithoutOperations(text) {
	const filesWithoutOps = [];
	const declaredFiles = extractFileDeclarations(text);

	for (const [fileName, position] of declaredFiles) {
		const operations = hasFileOperations(text, fileName);
		const missing = [];

		if (!operations.hasOpen) {
			missing.push('OPEN');
		}
		if (!operations.hasClose) {
			missing.push('CLOSE');
		}
		if (!operations.hasReadOrWrite) {
			missing.push('READ ou WRITE');
		}

		if (missing.length > 0) {
			filesWithoutOps.push({
				fileName: fileName,
				line: position.line,
				column: position.column,
				missing: missing
			});
			console.log(`Ficheiro ${fileName} sem operações: ${missing.join(', ')}`);
		}
	}

	return filesWithoutOps;
}

/**
 * Extrai declarações de cursores no código COBOL (DECLARE CURSOR)
 * @param {string} text
 * @returns {Map<string, {line: number, column: number}>}
 */
function extractCursorDeclarations(text) {
	const cursors = new Map();
	const lines = text.split('\n');
	let inExecSqlBlock = false;
	let execSqlContent = '';
	let execSqlStartLine = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		// Detecta início de bloco EXEC SQL
		if (/EXEC\s+SQL/i.test(line)) {
			inExecSqlBlock = true;
			execSqlContent = line;
			execSqlStartLine = i;
			console.log(`Início de bloco EXEC SQL na linha ${i}`);
		} else if (inExecSqlBlock) {
			// Adiciona linha ao conteúdo do bloco SQL
			execSqlContent += ' ' + line.trim();
		}

		// Detecta fim de bloco EXEC SQL
		if (inExecSqlBlock && /END-EXEC/i.test(line)) {
			console.log(`Fim de bloco EXEC SQL na linha ${i}, conteúdo: ${execSqlContent.substring(0, 100)}...`);

			// Procura por DECLARE <nome> CURSOR no conteúdo completo do bloco
			const declareMatch = execSqlContent.match(/DECLARE\s+([A-Z0-9][\w-]*)\s+CURSOR/i);
			if (declareMatch) {
				const cursorName = declareMatch[1].toUpperCase();

				// Procura a linha onde o nome do cursor aparece para obter a coluna correta
				let cursorLine = execSqlStartLine;
				let cursorColumn = 0;
				for (let j = execSqlStartLine; j <= i; j++) {
					const searchLine = lines[j];
					const idx = searchLine.toUpperCase().indexOf(cursorName);
					if (idx !== -1) {
						cursorLine = j;
						cursorColumn = idx;
						break;
					}
				}

				cursors.set(cursorName, {
					line: cursorLine,
					column: cursorColumn
				});
				console.log(`Cursor declarado: ${cursorName} na linha ${cursorLine}`);
			}

			// Reset para próximo bloco
			inExecSqlBlock = false;
			execSqlContent = '';
			execSqlStartLine = -1;
		}
	}

	return cursors;
}

/**
 * Verifica operações de cursores (OPEN, FETCH, CLOSE) no código
 * @param {string} text
 * @param {string} cursorName - Nome do cursor a verificar
 * @returns {{hasOpen: boolean, hasFetch: boolean, hasClose: boolean}}
 */
function hasCursorOperations(text, cursorName) {
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let hasOpen = false;
	let hasFetch = false;
	let hasClose = false;
	let inExecSqlBlock = false;
	let execSqlContent = '';

	// Escapar hífens no nome do cursor para usar em regex
	const escapedCursorName = cursorName.replace(/-/g, '\\-');
	const cursorNameRegex = new RegExp('\\b' + escapedCursorName + '\\b', 'i');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		// Detecta início de bloco EXEC SQL
		if (/EXEC\s+SQL/i.test(line)) {
			inExecSqlBlock = true;
			execSqlContent = line;
		} else if (inExecSqlBlock) {
			// Adiciona linha ao conteúdo do bloco SQL
			execSqlContent += ' ' + line.trim();
		}

		// Detecta fim de bloco EXEC SQL
		if (inExecSqlBlock && /END-EXEC/i.test(line)) {
			// Processa o bloco SQL completo

			// Verifica OPEN
			if (/\bOPEN\b/i.test(execSqlContent) && cursorNameRegex.test(execSqlContent)) {
				hasOpen = true;
				console.log(`OPEN encontrado para cursor ${cursorName} na linha ${i}`);
			}

			// Verifica FETCH
			if (/\bFETCH\b/i.test(execSqlContent) && cursorNameRegex.test(execSqlContent)) {
				hasFetch = true;
				console.log(`FETCH encontrado para cursor ${cursorName} na linha ${i}`);
			}

			// Verifica CLOSE
			if (/\bCLOSE\b/i.test(execSqlContent) && cursorNameRegex.test(execSqlContent)) {
				hasClose = true;
				console.log(`CLOSE encontrado para cursor ${cursorName} na linha ${i}`);
			}

			// Reset para próximo bloco
			inExecSqlBlock = false;
			execSqlContent = '';
		}
	}

	return { hasOpen, hasFetch, hasClose };
}

/**
 * Verifica cursores sem operações completas (OPEN, FETCH, CLOSE)
 * @param {string} text
 * @returns {Array<{cursorName: string, line: number, column: number, missing: string[]}>}
 */
function findCursorsWithoutOperations(text) {
	const cursorsWithoutOps = [];
	const declaredCursors = extractCursorDeclarations(text);

	for (const [cursorName, position] of declaredCursors) {
		const operations = hasCursorOperations(text, cursorName);
		const missing = [];

		if (!operations.hasOpen) {
			missing.push('OPEN');
		}
		if (!operations.hasFetch) {
			missing.push('FETCH');
		}
		if (!operations.hasClose) {
			missing.push('CLOSE');
		}

		if (missing.length > 0) {
			cursorsWithoutOps.push({
				cursorName: cursorName,
				line: position.line,
				column: position.column,
				missing: missing
			});
			console.log(`Cursor ${cursorName} sem operações: ${missing.join(', ')}`);
		}
	}

	return cursorsWithoutOps;
}

/**
 * Verifica valores hardcoded no código (strings e números literais)
 * @param {string} text
 * @returns {Array<{line: number, column: number, length: number, value: string, type: string}>}
 */
function findHardcodedValues(text, enableInString = false, enableInDisplay = false) {
	const hardcoded = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;
	const processedLines = new Set(); // Rastreia linhas já processadas

	for (let i = 0; i < lines.length; i++) {
		// Pula linhas já processadas como parte de comando multi-linha
		if (processedLines.has(i)) {
			continue;
		}

		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (line.length > 6 && line[6] === '*') {
			continue;
		}

		const lineContent = line.substring(6);

		// Ignora linhas que definem parágrafos (nome na área A seguido de ponto)
		// Área A começa na coluna 8 (índice 7 da linha completa, índice 1 do lineContent)
		if (/^\s{0,3}[A-Z0-9][A-Z0-9-]*\s*\.\s*$/i.test(lineContent)) {
			continue;
		}

		// Verifica se a linha contém STRING ou DISPLAY
		const hasString = /\bSTRING\b/i.test(lineContent);
		const hasDisplay = /\bDISPLAY\b/i.test(lineContent);
		const hasUnstring = /\bUNSTRING\b/i.test(lineContent);

		// Ignora linhas com GO TO, GOTO (mas não PERFORM para validar loops)
		if (/\b(GO\s*TO|GOTO)\b/i.test(lineContent)) {
			continue;
		}

		// Se tem DISPLAY e não está habilitado, ignora
		if (hasDisplay && !enableInDisplay) {
			continue;
		}

		// Se tem STRING ou UNSTRING e não está habilitado, ignora
		if ((hasString || hasUnstring) && !enableInString) {
			continue;
		}

		// Valida hardcode em comandos onde variáveis podem ser usadas, ou em STRING/DISPLAY se habilitado
		const isValidCommandForHardcode = /\b(MOVE|IF|WHEN|COMPUTE|EVALUATE|ADD|SUBTRACT|MULTIPLY|DIVIDE|PERFORM|=|>|<|STRING|DISPLAY|UNSTRING)\b/i.test(lineContent);

		if (!isValidCommandForHardcode) {
			continue;
		}

		// Combina linhas de continuação
		const statementLines = [{ index: i, content: lineContent, fullLine: line }];
		let currentIndex = i;

		// Verifica se o comando continua nas próximas linhas (não termina com ponto e não é uma palavra-chave terminal)
		while (currentIndex < lines.length - 1) {
			const currentContent = statementLines[statementLines.length - 1].content.trim();

			// Se termina com ponto, fim do comando
			if (currentContent.endsWith('.')) {
				break;
			}

			// Se termina com palavra-chave terminal (END-IF, ELSE, etc), fim do comando
			if (/\b(END-IF|END-PERFORM|END-EVALUATE|END-COMPUTE|ELSE|WHEN)\s*$/i.test(currentContent)) {
				break;
			}

			// Verifica próxima linha
			const nextIndex = currentIndex + 1;
			const nextLine = lines[nextIndex];

			// Se é comentário, pula
			if (nextLine.length > 6 && nextLine[6] === '*') {
				currentIndex++;
				continue;
			}

			const nextLineContent = nextLine.substring(6);

			// Se a próxima linha define um novo parágrafo ou comando, fim
			if (/^\s{0,3}[A-Z0-9][A-Z0-9-]*\s*\./i.test(nextLineContent) ||
			    /^\s*(MOVE|IF|WHEN|COMPUTE|EVALUATE|ADD|SUBTRACT|MULTIPLY|DIVIDE|PERFORM|DISPLAY|STRING|UNSTRING|END-IF|END-PERFORM|ELSE)\b/i.test(nextLineContent)) {
				break;
			}

			// Adiciona linha de continuação
			statementLines.push({ index: nextIndex, content: nextLineContent, fullLine: nextLine });
			processedLines.add(nextIndex);
			currentIndex++;
		}

		// Processa cada linha do comando (mesmo que seja multi-linha)
		for (const { index: lineIndex, content: lineContent, fullLine: line } of statementLines) {
			// Remove reference modifications (substring) da linha para não validar os números dentro delas
			// Exemplo: WS-VAR(1:10) -> WS-VAR(), WS-VAR(inicio:5) -> WS-VAR()
			const lineWithoutRefMod = lineContent.replace(/\([^)]*:[^)]*\)/g, '()');

			// Detecta strings literais entre aspas simples ou duplas
			const stringMatches = [...lineWithoutRefMod.matchAll(/(['"])([^'"]+)\1/g)];
			for (const match of stringMatches) {
				const value = match[0];
				// Encontra a posição na linha original
				const column = line.indexOf(value);
				if (column !== -1) {
					hardcoded.push({
						line: lineIndex,
						column: column,
						length: value.length,
						value: value,
						type: 'string'
					});
					console.log(`String hardcoded encontrada na linha ${lineIndex}: ${value}`);
				}
			}

			// Detecta números literais em comandos (MOVE, IF, COMPUTE, etc)
			// Mas não em declarações PIC ou dentro de reference modifications ou strings literais
			if (!/\bPIC\b|\bPICTURE\b/i.test(lineContent)) {
				// Remove strings literais e reference modifications para não validar números dentro delas
				// Exemplo: 'ABC123' -> '', WS-VAR(1:10) -> WS-VAR()
				const lineWithoutStringsAndRefMod = lineWithoutRefMod.replace(/(['"])([^'"]*)\1/g, '');

				// Usa lookbehind/lookahead para garantir que o número está isolado
				// Não precedido ou seguido por letra, número ou hífen (parte de identificador)
				const numberMatches = [...lineWithoutStringsAndRefMod.matchAll(/(?<![A-Z0-9-])(\d+(?:\.\d+)?)(?![A-Z0-9-])/gi)];
				for (const match of numberMatches) {
					const value = match[1];
					const matchIndex = match.index;

					// Calcula a posição real na linha original
					// Precisa procurar o número na linha original próximo da posição calculada
					const searchStart = line.substring(0, 6).length + matchIndex;
					const searchContext = line.substring(Math.max(0, searchStart - 5), searchStart + value.length + 5);
					const indexInContext = searchContext.indexOf(value);

					if (indexInContext !== -1) {
						const column = Math.max(0, searchStart - 5) + indexInContext;
						const actualSubstring = line.substring(column, column + value.length);

						// Verifica se o número realmente existe na posição calculada da linha original
						// e não está dentro de parênteses com dois pontos (reference modification)
						if (actualSubstring === value) {
							const beforeNum = line.substring(Math.max(0, column - 10), column);
							const afterNum = line.substring(column + value.length, Math.min(line.length, column + value.length + 10));

							// Verifica se não faz parte de uma reference modification
							const isInRefMod = /\([^)]*$/.test(beforeNum) && /^[^(]*:/.test(afterNum) ||
							                   /:[^)]*$/.test(beforeNum) && /^[^(]*\)/.test(afterNum);

							// Verifica se não está dentro de uma string literal (entre aspas ou pelicas)
							const beforeContext = line.substring(0, column);
							const singleQuotes = (beforeContext.match(/'/g) || []).length;
							const doubleQuotes = (beforeContext.match(/"/g) || []).length;
							const isInString = (singleQuotes % 2 !== 0) || (doubleQuotes % 2 !== 0);

							if (!isInRefMod && !isInString) {
								hardcoded.push({
									line: lineIndex,
									column: column,
									length: value.length,
									value: value,
									type: 'number'
								});
								console.log(`Número hardcoded encontrado na linha ${lineIndex}: ${value}`);
							}
						}
					}
				}
			}
		}
	}

	return hardcoded;
}

/**
 * Valida o documento COBOL e atualiza os diagnósticos
 * @param {vscode.TextDocument} document
 */
function validateCobolDocument(document) {
	if (!isCobolFile(document)) {
		console.log('Não é ficheiro COBOL:', document.fileName);
		return;
	}

	console.log('Validando ficheiro COBOL:', document.fileName);
	const diagnostics = [];
	const text = document.getText();
	const config = vscode.workspace.getConfiguration('zcobol-validation');

	// Validação de variáveis não utilizadas
	const enableUnusedVarCheck = config.get('enableUnusedVariableCheck', true);
	if (enableUnusedVarCheck) {
		const declaredVariables = extractDeclaredVariables(text);
		console.log('Variáveis declaradas:', Array.from(declaredVariables.keys()));

		// Verifica cada variável declarada
		for (const [varName, position] of declaredVariables) {
			const isUsed = isVariableUsed(text, varName, position.isLinkage);
			console.log(`Variável ${varName} (${position.isLinkage ? 'LINKAGE' : 'WORKING-STORAGE'}): ${isUsed ? 'USADA' : 'NÃO USADA'}`);

			if (!isUsed) {
				const range = new vscode.Range(
					position.line,
					position.column,
					position.line,
					position.column + varName.length
				);

				const diagnostic = new vscode.Diagnostic(
					range,
					`Variable '${varName}' is declared but not used`,
					vscode.DiagnosticSeverity.Warning
				);
				diagnostic.code = 'unused-variable';
				diagnostic.source = 'zCobol Validation';

				diagnostics.push(diagnostic);
			}
		}
	}

	// Validação de displays não protegidos
	const enableUnprotectedDisplayCheck = config.get('enableUnprotectedDisplayCheck', true);
	if (enableUnprotectedDisplayCheck) {
		const unprotectedDisplays = findUnprotectedDisplays(text);
		console.log('Displays não protegidos encontrados:', unprotectedDisplays.length);

		for (const display of unprotectedDisplays) {
			const range = new vscode.Range(
				display.line,
				display.column,
				display.line,
				display.column + display.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				'Unprotected DISPLAY - consider adding inside an IF block',
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'unprotected-display';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	// Validação de comandos GO TO
	const enableGoToCheck = config.get('enableGoToCheck', true);
	if (enableGoToCheck) {
		const gotos = findGoToStatements(text);
		console.log('Comandos GO TO encontrados:', gotos.length);

		for (const goto of gotos) {
			const range = new vscode.Range(
				goto.line,
				goto.column,
				goto.line,
				goto.column + goto.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`GO TO command detected - consider refactoring using PERFORM`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'goto-statement';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	// Validação de IFs sem END-IF
	const enableUnmatchedIfCheck = config.get('enableUnmatchedIfCheck', true);
	if (enableUnmatchedIfCheck) {
		const unmatchedIfs = findUnmatchedIfs(text);
		console.log('IFs sem END-IF encontrados:', unmatchedIfs.length);

		for (const ifStatement of unmatchedIfs) {
			const range = new vscode.Range(
				ifStatement.line,
				ifStatement.column,
				ifStatement.line,
				ifStatement.column + ifStatement.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`IF without matching END-IF - check block structure`,
				vscode.DiagnosticSeverity.Error
			);
			diagnostic.code = 'unmatched-if';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	// Validação de IFs sem ELSE
	const enableIfWithoutElseCheck = config.get('enableIfWithoutElseCheck', false);
	if (enableIfWithoutElseCheck) {
		const ifsWithoutElse = findIfsWithoutElse(text);
		console.log('IFs sem ELSE encontrados:', ifsWithoutElse.length);

		for (const ifStatement of ifsWithoutElse) {
			const range = new vscode.Range(
				ifStatement.line,
				ifStatement.column,
				ifStatement.line,
				ifStatement.column + ifStatement.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`IF without ELSE - consider adding an ELSE block to ensure complete coverage`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'if-without-else';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	// Validação de EVALUATE sem WHEN OTHER
	const enableEvaluateWithoutWhenOtherCheck = config.get('enableEvaluateWithoutWhenOtherCheck', false);
	if (enableEvaluateWithoutWhenOtherCheck) {
		const evaluatesWithoutWhenOther = findEvaluatesWithoutWhenOther(text);
		console.log('EVALUATE sem WHEN OTHER encontrados:', evaluatesWithoutWhenOther.length);

		for (const evaluateStatement of evaluatesWithoutWhenOther) {
			const range = new vscode.Range(
				evaluateStatement.line,
				evaluateStatement.column,
				evaluateStatement.line,
				evaluateStatement.column + evaluateStatement.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`EVALUATE without WHEN OTHER - consider adding a WHEN OTHER block to ensure complete coverage`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'evaluate-without-when-other';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	// Validação de operadores simbólicos em IFs
	const enableSymbolicOperatorCheck = config.get('enableSymbolicOperatorCheck', true);
	if (enableSymbolicOperatorCheck) {
		const operatorFormat = config.get('operatorFormat', 'long');
		const useShortForm = operatorFormat === 'short';
		const symbolicOperators = findSymbolicOperatorsInIf(text, useShortForm);
		console.log('Operadores simbólicos encontrados:', symbolicOperators.length);

		for (const op of symbolicOperators) {
			const range = new vscode.Range(
				op.line,
				op.column,
				op.line,
				op.column + op.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`Use '${op.replacement}' em vez de '${op.operator}' em condições COBOL`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'symbolic-operator';
			diagnostic.source = 'zCobol Validation';
			// Armazena o operador e replacement no diagnostic para usar nas code actions
			diagnostic.relatedInformation = [{
				location: new vscode.Location(document.uri, range),
				message: `${op.operator}:${op.replacement}`
			}];

			diagnostics.push(diagnostic);
		}
	}

	// Validação de valores hardcoded
	const enableHardcodedCheck = config.get('enableHardcodedCheck', true);
	if (enableHardcodedCheck) {
		const enableInString = config.get('enableHardcodedInString', false);
		const enableInDisplay = config.get('enableHardcodedInDisplay', false);
		const hardcodedValues = findHardcodedValues(text, enableInString, enableInDisplay);
		console.log('Valores hardcoded encontrados:', hardcodedValues.length);

		for (const hardcoded of hardcodedValues) {
			const range = new vscode.Range(
				hardcoded.line,
				hardcoded.column,
				hardcoded.line,
				hardcoded.column + hardcoded.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`Hardcoded value detected (${hardcoded.value}) - consider creating a constant`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'hardcoded-value';
			diagnostic.source = 'zCobol Validation';
			// Armazena o valor e tipo no diagnostic para usar nas code actions
			diagnostic.relatedInformation = [{
				location: new vscode.Location(document.uri, range),
				message: `${hardcoded.type}:${hardcoded.value}`
			}];

			diagnostics.push(diagnostic);
		}
	}

	// Validação de código em minúsculas
	const enableLowerCaseCheck = config.get('enableLowerCaseCheck', false);
	if (enableLowerCaseCheck) {
		const lowerCaseCode = findLowerCaseCode(text);
		console.log('Código em minúsculas encontrado:', lowerCaseCode.length);

		for (const lowerCase of lowerCaseCode) {
			const range = new vscode.Range(
				lowerCase.line,
				lowerCase.column,
				lowerCase.line,
				lowerCase.column + lowerCase.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`Lowercase code detected: '${lowerCase.word}' - COBOL should be written in uppercase`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'lower-case-code';
			diagnostic.source = 'zCobol Validation';
			// Armazena a palavra no diagnostic para usar nas code actions
			diagnostic.relatedInformation = [{
				location: new vscode.Location(document.uri, range),
				message: lowerCase.word
			}];

			diagnostics.push(diagnostic);
		}
	}

	// Validação de operações de ficheiro (OPEN, CLOSE, READ/WRITE)
	const enableFileOperationsCheck = config.get('enableFileOperationsCheck', true);
	if (enableFileOperationsCheck) {
		const filesWithoutOps = findFilesWithoutOperations(text);
		console.log('Files without complete operations:', filesWithoutOps.length);

		for (const file of filesWithoutOps) {
			const range = new vscode.Range(
				file.line,
				file.column,
				file.line,
				file.column + file.fileName.length
			);

			const missingOps = file.missing.join(', ');
			const diagnostic = new vscode.Diagnostic(
				range,
				`File '${file.fileName}' declared but missing: ${missingOps}`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'missing-file-operations';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	// Validação de operações de cursor (OPEN, FETCH, CLOSE)
	const enableCursorOperationsCheck = config.get('enableCursorOperationsCheck', true);
	if (enableCursorOperationsCheck) {
		const cursorsWithoutOps = findCursorsWithoutOperations(text);
		console.log('Cursors without complete operations:', cursorsWithoutOps.length);

		for (const cursor of cursorsWithoutOps) {
			const range = new vscode.Range(
				cursor.line,
				cursor.column,
				cursor.line,
				cursor.column + cursor.cursorName.length
			);

			const missingOps = cursor.missing.join(', ');
			const diagnostic = new vscode.Diagnostic(
				range,
				`Cursor '${cursor.cursorName}' declared but missing: ${missingOps}`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'missing-cursor-operations';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	console.log('Total de warnings criados:', diagnostics.length);
	diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Provedor de code actions para resolver warnings de variáveis não utilizadas
 */
class CobolCodeActionProvider {
	provideCodeActions(document, range, context) {
		const codeActions = [];

		// Procura por diagnósticos de variáveis não utilizadas na posição atual
		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'unused-variable') {
				// Action 1: Delete line
				const deleteLine = new vscode.CodeAction('Delete line', vscode.CodeActionKind.QuickFix);
				deleteLine.diagnostics = [diagnostic];
				deleteLine.edit = new vscode.WorkspaceEdit();

				const deleteRange = new vscode.Range(
					diagnostic.range.start.line,
					0,
					diagnostic.range.start.line + 1,
					0
				);
				deleteLine.edit.delete(document.uri, deleteRange);
				codeActions.push(deleteLine);

				// Action 2: Comment line (asterisk in column 7)
				const commentLine = new vscode.CodeAction('Comment line (asterisk)', vscode.CodeActionKind.QuickFix);
				commentLine.diagnostics = [diagnostic];
				commentLine.edit = new vscode.WorkspaceEdit();

				const line = document.lineAt(diagnostic.range.start.line);
				const lineText = line.text;
				let newLineText;

				// Em COBOL, o asterisco deve estar na coluna 7 (índice 6)
				if (lineText.length >= 7) {
					newLineText = lineText.substring(0, 6) + '*' + lineText.substring(7);
				} else {
					// Se a linha for muito curta, preenche com espaços até a coluna 7
					newLineText = lineText.padEnd(6, ' ') + '*';
				}

				commentLine.edit.replace(
					document.uri,
					line.range,
					newLineText
				);
				codeActions.push(commentLine);
			}

			// Code actions para displays não protegidos
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'unprotected-display') {
				const line = document.lineAt(diagnostic.range.start.line);
				const lineText = line.text;

				// Action 1: Wrap with IF and END-IF
				const wrapWithIf = new vscode.CodeAction('Wrap with IF...END-IF', vscode.CodeActionKind.QuickFix);
				wrapWithIf.diagnostics = [diagnostic];

				// Use a command to allow cursor positioning
				wrapWithIf.command = {
					title: 'Wrap with IF...END-IF',
					command: 'zcobol-validation.wrapWithIf',
					arguments: [document, diagnostic.range.start.line]
				};
				codeActions.push(wrapWithIf);

				// Action 2: Comment line
				const commentDisplay = new vscode.CodeAction('Comment line (asterisk)', vscode.CodeActionKind.QuickFix);
				commentDisplay.diagnostics = [diagnostic];
				commentDisplay.edit = new vscode.WorkspaceEdit();

				let newLineText;
				if (lineText.length >= 7) {
					newLineText = lineText.substring(0, 6) + '*' + lineText.substring(7);
				} else {
					newLineText = lineText.padEnd(6, ' ') + '*';
				}

				commentDisplay.edit.replace(document.uri, line.range, newLineText);
				codeActions.push(commentDisplay);

				// Action 3: Delete line
				const deleteDisplay = new vscode.CodeAction('Delete line', vscode.CodeActionKind.QuickFix);
				deleteDisplay.diagnostics = [diagnostic];
				deleteDisplay.edit = new vscode.WorkspaceEdit();

				const deleteRange = new vscode.Range(
					diagnostic.range.start.line,
					0,
					diagnostic.range.start.line + 1,
					0
				);
				deleteDisplay.edit.delete(document.uri, deleteRange);
				codeActions.push(deleteDisplay);
			}

			// Code actions para comandos GO TO
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'goto-statement') {
				const line = document.lineAt(diagnostic.range.start.line);
				const lineText = line.text;

				// Action 1: Comment line
				const commentGoTo = new vscode.CodeAction('Comment line (asterisk)', vscode.CodeActionKind.QuickFix);
				commentGoTo.diagnostics = [diagnostic];
				commentGoTo.edit = new vscode.WorkspaceEdit();

				let newLineText;
				if (lineText.length >= 7) {
					newLineText = lineText.substring(0, 6) + '*' + lineText.substring(7);
				} else {
					newLineText = lineText.padEnd(6, ' ') + '*';
				}

				commentGoTo.edit.replace(document.uri, line.range, newLineText);
				codeActions.push(commentGoTo);

				// Ação 2: Eliminar a linha
				const deleteGoTo = new vscode.CodeAction('Delete line', vscode.CodeActionKind.QuickFix);
				deleteGoTo.diagnostics = [diagnostic];
				deleteGoTo.edit = new vscode.WorkspaceEdit();

				const deleteRange = new vscode.Range(
					diagnostic.range.start.line,
					0,
					diagnostic.range.start.line + 1,
					0
				);
				deleteGoTo.edit.delete(document.uri, deleteRange);
				codeActions.push(deleteGoTo);
			}

			// Code actions para IFs sem END-IF
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'unmatched-if') {
				const line = document.lineAt(diagnostic.range.start.line);
				const lineText = line.text;
				const indentation = lineText.substring(0, lineText.search(/\S|$/));

				// Ação 1: Adicionar END-IF
				const addEndIf = new vscode.CodeAction('Add END-IF', vscode.CodeActionKind.QuickFix);
				addEndIf.diagnostics = [diagnostic];
				addEndIf.edit = new vscode.WorkspaceEdit();

				// Encontra a próxima linha não vazia após o IF para inserir o END-IF
				let insertLine = diagnostic.range.start.line + 1;
				while (insertLine < document.lineCount) {
					const nextLine = document.lineAt(insertLine);
					if (nextLine.text.trim().length > 0) {
						break;
					}
					insertLine++;
				}

				// Insere END-IF após a linha do IF
				addEndIf.edit.insert(
					document.uri,
					new vscode.Position(insertLine, 0),
					`${indentation}END-IF.\n`
				);
				codeActions.push(addEndIf);

				// Ação 2: Comentar a linha
				const commentIf = new vscode.CodeAction('Comment line (asterisk)', vscode.CodeActionKind.QuickFix);
				commentIf.diagnostics = [diagnostic];
				commentIf.edit = new vscode.WorkspaceEdit();

				let newLineText;
				if (lineText.length >= 7) {
					newLineText = lineText.substring(0, 6) + '*' + lineText.substring(7);
				} else {
					newLineText = lineText.padEnd(6, ' ') + '*';
				}

				commentIf.edit.replace(document.uri, line.range, newLineText);
				codeActions.push(commentIf);
			}

			// Code actions para IFs sem ELSE
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'if-without-else') {
				const line = document.lineAt(diagnostic.range.start.line);
				const lineText = line.text;
				const indentation = lineText.substring(0, lineText.search(/\S|$/));

				// Ação 1: Adicionar ELSE com CONTINUE
				const addElseContinue = new vscode.CodeAction('Add ELSE with CONTINUE', vscode.CodeActionKind.QuickFix);
				addElseContinue.diagnostics = [diagnostic];
				addElseContinue.edit = new vscode.WorkspaceEdit();

				// Encontra o END-IF correspondente
				let endIfLine = -1;
				let nestingLevel = 1;
				for (let j = diagnostic.range.start.line + 1; j < document.lineCount; j++) {
					const nextLine = document.lineAt(j);
					const content = nextLine.text.substring(6);

					// Ignora comentários
					if (nextLine.text.length > 6 && nextLine.text[6] === '*') {
						continue;
					}

					// Detecta IF aninhado
					if (/^\s*IF\s+/i.test(content) && !/^\s*END-IF/i.test(content)) {
						nestingLevel++;
					}

					// Detecta END-IF
					if (/^\s*END-IF/i.test(content)) {
						nestingLevel--;
						if (nestingLevel === 0) {
							endIfLine = j;
							break;
						}
					}
				}

				if (endIfLine !== -1) {
					// Insere ELSE com CONTINUE antes do END-IF
					addElseContinue.edit.insert(
						document.uri,
						new vscode.Position(endIfLine, 0),
						`${indentation}ELSE\n${indentation}   CONTINUE\n`
					);
					codeActions.push(addElseContinue);

					// Ação 2: Adicionar apenas ELSE
					const addElse = new vscode.CodeAction('Add ELSE', vscode.CodeActionKind.QuickFix);
					addElse.diagnostics = [diagnostic];
					addElse.edit = new vscode.WorkspaceEdit();
					addElse.edit.insert(
						document.uri,
						new vscode.Position(endIfLine, 0),
						`${indentation}ELSE\n${indentation}   \n`
					);
					codeActions.push(addElse);
				}
			}

			// Code actions para EVALUATE sem WHEN OTHER
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'evaluate-without-when-other') {
				const line = document.lineAt(diagnostic.range.start.line);
				const lineText = line.text;
				const indentation = lineText.substring(0, lineText.search(/\S|$/));

				// Ação 1: Adicionar WHEN OTHER com CONTINUE
				const addWhenOtherContinue = new vscode.CodeAction('Add WHEN OTHER with CONTINUE', vscode.CodeActionKind.QuickFix);
				addWhenOtherContinue.diagnostics = [diagnostic];
				addWhenOtherContinue.edit = new vscode.WorkspaceEdit();

				// Encontra o END-EVALUATE correspondente
				let endEvaluateLine = -1;
				let nestingLevel = 1;
				for (let j = diagnostic.range.start.line + 1; j < document.lineCount; j++) {
					const nextLine = document.lineAt(j);
					const content = nextLine.text.substring(6);

					// Ignora comentários
					if (nextLine.text.length > 6 && nextLine.text[6] === '*') {
						continue;
					}

					// Detecta EVALUATE aninhado
					if (/^\s*EVALUATE\s+/i.test(content)) {
						nestingLevel++;
					}

					// Detecta END-EVALUATE
					if (/^\s*END-EVALUATE/i.test(content)) {
						nestingLevel--;
						if (nestingLevel === 0) {
							endEvaluateLine = j;
							break;
						}
					}
				}

				if (endEvaluateLine !== -1) {
					// Insere WHEN OTHER com CONTINUE antes do END-EVALUATE
					addWhenOtherContinue.edit.insert(
						document.uri,
						new vscode.Position(endEvaluateLine, 0),
						`${indentation}WHEN OTHER\n${indentation}   CONTINUE\n`
					);
					codeActions.push(addWhenOtherContinue);

					// Ação 2: Adicionar apenas WHEN OTHER
					const addWhenOther = new vscode.CodeAction('Add WHEN OTHER', vscode.CodeActionKind.QuickFix);
					addWhenOther.diagnostics = [diagnostic];
					addWhenOther.edit = new vscode.WorkspaceEdit();
					addWhenOther.edit.insert(
						document.uri,
						new vscode.Position(endEvaluateLine, 0),
						`${indentation}WHEN OTHER\n${indentation}   \n`
					);
					codeActions.push(addWhenOther);
				}
			}

			// Code actions para operadores simbólicos
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'symbolic-operator') {
				// Extrai o operador e replacement do diagnostic
				// let operator = '';
				let replacement = '';
				if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
					const info = diagnostic.relatedInformation[0].message;
					const parts = info.split(':');
					// operator = parts[0];
					replacement = parts[1];
				}

				// Ação: Substituir pelo operador COBOL
				const replaceOperator = new vscode.CodeAction(`Substituir por '${replacement}'`, vscode.CodeActionKind.QuickFix);
				replaceOperator.diagnostics = [diagnostic];
				replaceOperator.edit = new vscode.WorkspaceEdit();
				replaceOperator.edit.replace(document.uri, diagnostic.range, replacement);
				codeActions.push(replaceOperator);
			}

			// Code actions para valores hardcoded
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'hardcoded-value') {
				// Extrai o valor e tipo do diagnostic
				let hardcodedValue = '';
				let valueType = 'string';
				if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
					const info = diagnostic.relatedInformation[0].message;
					const parts = info.split(':');
					valueType = parts[0];
					hardcodedValue = parts.slice(1).join(':');
				}

			// Use a command to allow user input for the constant name
				const createConstant = new vscode.CodeAction('Create constant', vscode.CodeActionKind.QuickFix);
				createConstant.diagnostics = [diagnostic];
				createConstant.command = {
					title: 'Create constant',
					command: 'zcobol-validation.createConstant',
					arguments: [document, diagnostic.range, hardcodedValue, valueType]
				};
				codeActions.push(createConstant);
			}

			// Code actions para código em minúsculas
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'lower-case-code') {
				// Extrai a palavra do diagnostic
				let word = '';
				if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
					word = diagnostic.relatedInformation[0].message;
				}

				const upperCaseWord = word.toUpperCase();

				// Ação: Converter para maiúsculas
				const convertToUpperCase = new vscode.CodeAction(`Converter para maiúsculas: ${upperCaseWord}`, vscode.CodeActionKind.QuickFix);
				convertToUpperCase.diagnostics = [diagnostic];
				convertToUpperCase.edit = new vscode.WorkspaceEdit();
				convertToUpperCase.edit.replace(document.uri, diagnostic.range, upperCaseWord);
				codeActions.push(convertToUpperCase);
			}
		}

		return codeActions;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "zcobol-validation" is now active!');

	// Cria a coleção de diagnósticos
	diagnosticCollection = vscode.languages.createDiagnosticCollection('cobol');
	context.subscriptions.push(diagnosticCollection);

	// Register the code actions provider for COBOL files
	const cobolSelector = [
		{ scheme: 'file', language: 'cobol' },
		{ scheme: 'file', pattern: '**/*.{cbl,cob,cobol,cpy}' }
	];
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			cobolSelector,
			new CobolCodeActionProvider(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
		)
	);

	// Register the command to wrap with IF...END-IF
	context.subscriptions.push(
		vscode.commands.registerCommand('zcobol-validation.wrapWithIf', async (document, lineNumber) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			const line = document.lineAt(lineNumber);
			const lineText = line.text;
			const indentation = lineText.substring(0, lineText.search(/\S|$/));

			// Get default condition from settings
			const config = vscode.workspace.getConfiguration('zcobol-validation');
			const defaultCondition = config.get('defaultIfCondition', '');

			await editor.edit(editBuilder => {
				// Remove ponto final da linha DISPLAY se existir
				let displayContent = lineText.trim();
				if (displayContent.endsWith('.')) {
					displayContent = displayContent.substring(0, displayContent.length - 1);
				}

				// Indenta a linha DISPLAY (adiciona 3 espaços) e remove o ponto final
				const displayIndentation = indentation + '   ';
				editBuilder.replace(
					new vscode.Range(lineNumber, 0, lineNumber, lineText.length),
					`${displayIndentation}${displayContent}`
				);

				// Insere IF antes
				editBuilder.insert(new vscode.Position(lineNumber, 0),
					`${indentation}IF \n`);

				// Insere END-IF imediatamente após a linha do DISPLAY (com ponto final)
				editBuilder.insert(new vscode.Position(lineNumber + 1, 0),
					`${indentation}END-IF.\n`);
			});

			// Position cursor after "IF " in the IF line to fill in the condition
			const newPosition = new vscode.Position(lineNumber, indentation.length + 3);
			editor.selection = new vscode.Selection(newPosition, newPosition);

			// Insert a snippet with default condition or placeholder
			const snippetText = defaultCondition ? `\${1:${defaultCondition}}` : '${1:condition}';
			await editor.insertSnippet(
				new vscode.SnippetString(snippetText),
				newPosition
			);
		})
	);

	// Register the command to create constant
	context.subscriptions.push(
		vscode.commands.registerCommand('zcobol-validation.createConstant', async (document, range, hardcodedValue, valueType) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			// Check if a constant with the same value already exists
			let existingConstant = null;
			let workingStorageLine = -1;
		let lastCompleteVarLine = -1;
		let inWorkingStorage = false;

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i).text;

			if (/^\s*WORKING-STORAGE\s+SECTION/i.test(line)) {
				workingStorageLine = i;
				inWorkingStorage = true;
				continue;
			}

			// Se encontrar outra seção, sai da WORKING-STORAGE
			if (inWorkingStorage && /^\s*(LINKAGE|LOCAL-STORAGE|FILE|SCREEN)\s+SECTION/i.test(line)) {
				inWorkingStorage = false;
			}

			// Dentro da WORKING-STORAGE, procura linhas que terminam com ponto (fim de definição completa)
			if (inWorkingStorage && /\.\s*$/.test(line)) {
				lastCompleteVarLine = i;
			}

			// Verifica se já existe uma constante com o mesmo valor
			if (inWorkingStorage && /^\s{6,}\s*01\s+/i.test(line)) {
				const valueMatch = line.match(/^\s{6,}\s*01\s+([A-Z0-9][\w-]*)\s+.*VALUE\s+(.+?)\.?\s*$/i);
				if (valueMatch) {
					const constName = valueMatch[1];
					const constValue = valueMatch[2].trim();

					// Compara o valor (remove espaços extras)
					if (constValue === hardcodedValue.trim()) {
						existingConstant = constName;
						console.log(`Existing constant found: ${constName} with value ${constValue}`);
						break;
					}
				}
			}

			if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
				break;
			}
		}

		// If found an existing constant, use it
		if (existingConstant) {
			const useExisting = await vscode.window.showInformationMessage(
				`Constant '${existingConstant}' already exists with this value. Do you want to use it?`,
				'Yes', 'No, create new'
			);

			if (useExisting === 'Yes') {
				// Replace the hardcoded value with the existing constant
				await editor.edit(editBuilder => {
					editBuilder.replace(range, existingConstant);
				});
				return;
			}
			// If chose "No, create new", continue to create a new constant
		}

		// Gera um nome padrão baseado no valor e no prefixo configurado
		const config = vscode.workspace.getConfiguration('zcobol-validation');
		const prefix = config.get('constantPrefix', 'CON-');

		// Extrai o valor sem aspas para gerar o nome
		let valueForName = hardcodedValue.trim();

		// Se for string (alfanumérico), remove as aspas/pelicas do valor para usar no nome
		if (valueType === 'string') {
			// Remove aspas simples ou duplas do início e fim
			valueForName = valueForName.replace(/^['"]|['"]$/g, '');
		}

		// Sanitiza o valor para nome válido COBOL (remove caracteres inválidos, max 30 chars)
		let sanitizedValue = valueForName.replace(/[^A-Z0-9]/gi, '-').substring(0, 25);
		const defaultName = (prefix + sanitizedValue).toUpperCase();

		// Ask user for the constant name with default suggestion
		const constantName = await vscode.window.showInputBox({
			prompt: 'Constant name',
			value: defaultName,
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return 'Constant name cannot be empty';
				}
				if (!/^[A-Z][A-Z0-9-]*$/i.test(value)) {
					return 'Name must start with a letter and contain only letters, numbers and hyphens';
				}
			return null;
		}
	});

	if (!constantName) {
		return; // User cancelled
	}

	// Check if WORKING-STORAGE SECTION was found
	if (workingStorageLine < 0) {
		vscode.window.showErrorMessage('WORKING-STORAGE SECTION not found in document.');
		return;
	}

	// Determina o tipo PIC baseado no tipo do valor
	let picClause = '';
	let valueClause = hardcodedValue;

	if (valueType === 'string') {
		const valueLength = hardcodedValue.length - 2; // Remove aspas
		picClause = `PIC X(${valueLength.toString().padStart(2, '0')})`;
	} else {
		const valueLength = hardcodedValue.length;
		picClause = `PIC 9(${valueLength.toString().padStart(2, '0')})`;
	}

	// Insert the constant declaration in WORKING-STORAGE SECTION
	await editor.edit(editBuilder => {
		const insertLine = lastCompleteVarLine >= 0 ? lastCompleteVarLine + 1 : workingStorageLine + 1;
		const constantDecl = `       01  ${constantName.padEnd(28)} ${picClause} VALUE ${valueClause}.\n`;
		editBuilder.insert(new vscode.Position(insertLine, 0), constantDecl);

		// Replace the hardcoded value with the constant name
		editBuilder.replace(range, constantName);
	});
})
	);

	// Validate when document is modified
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			validateCobolDocument(event.document);
		})
	);

	// Validate when active editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				validateCobolDocument(editor.document);
			}
		})
	);

	// Validate all open documents
	vscode.workspace.textDocuments.forEach(document => {
		validateCobolDocument(document);
	});

	// Re-validate all documents when configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('zcobol-validation.enableUnusedVariableCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableUnprotectedDisplayCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableGoToCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableUnmatchedIfCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableIfWithoutElseCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableEvaluateWithoutWhenOtherCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableHardcodedCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableLowerCaseCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableSymbolicOperatorCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableFileOperationsCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableCursorOperationsCheck') ||
			    event.affectsConfiguration('zcobol-validation.operatorFormat')) {
				console.log('Configuration changed - revalidating all documents');
				vscode.workspace.textDocuments.forEach(document => {
					validateCobolDocument(document);
				});
			}
		})
	);
}

// This method is called when your extension is deactivated
function deactivate() {
	if (diagnosticCollection) {
		diagnosticCollection.clear();
		diagnosticCollection.dispose();
	}
}

module.exports = {
	activate,
	deactivate
}
