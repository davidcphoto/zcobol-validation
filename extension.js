// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// Diagnostic collection para warnings de variáveis não utilizadas
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
					`A variável '${varName}' está declarada mas não está a ser utilizada`,
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
				'DISPLAY não protegido - considere adicionar dentro de um bloco IF',
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
				`Comando GO TO detectado - considere refatorar usando PERFORM`,
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
				`IF sem END-IF correspondente - verifique a estrutura do bloco`,
				vscode.DiagnosticSeverity.Error
			);
			diagnostic.code = 'unmatched-if';
			diagnostic.source = 'zCobol Validation';

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
				`Valor hardcoded detectado (${hardcoded.value}) - considere criar uma constante`,
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
				// Ação 1: Eliminar a linha
				const deleteLine = new vscode.CodeAction('Eliminar linha', vscode.CodeActionKind.QuickFix);
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

				// Ação 2: Comentar a linha (asterisco na coluna 7)
				const commentLine = new vscode.CodeAction('Comentar linha (asterisco)', vscode.CodeActionKind.QuickFix);
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

				// Ação 1: Envolver com IF e END-IF
				const wrapWithIf = new vscode.CodeAction('Envolver com IF...END-IF', vscode.CodeActionKind.QuickFix);
				wrapWithIf.diagnostics = [diagnostic];

				// Usar um command para permitir posicionamento do cursor
				wrapWithIf.command = {
					title: 'Envolver com IF...END-IF',
					command: 'zcobol-validation.wrapWithIf',
					arguments: [document, diagnostic.range.start.line]
				};
				codeActions.push(wrapWithIf);

				// Ação 2: Comentar a linha
				const commentDisplay = new vscode.CodeAction('Comentar linha (asterisco)', vscode.CodeActionKind.QuickFix);
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

				// Ação 3: Eliminar a linha
				const deleteDisplay = new vscode.CodeAction('Eliminar linha', vscode.CodeActionKind.QuickFix);
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

				// Ação 1: Comentar a linha
				const commentGoTo = new vscode.CodeAction('Comentar linha (asterisco)', vscode.CodeActionKind.QuickFix);
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
				const deleteGoTo = new vscode.CodeAction('Eliminar linha', vscode.CodeActionKind.QuickFix);
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
				const addEndIf = new vscode.CodeAction('Adicionar END-IF', vscode.CodeActionKind.QuickFix);
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
				const commentIf = new vscode.CodeAction('Comentar linha (asterisco)', vscode.CodeActionKind.QuickFix);
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

				// Usa um command para permitir input do usuário para o nome da constante
				const createConstant = new vscode.CodeAction('Criar constante', vscode.CodeActionKind.QuickFix);
				createConstant.diagnostics = [diagnostic];
				createConstant.command = {
					title: 'Criar constante',
					command: 'zcobol-validation.createConstant',
					arguments: [document, diagnostic.range, hardcodedValue, valueType]
				};
				codeActions.push(createConstant);
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

	// Regista o provider de code actions para ficheiros COBOL
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

	// Regista o comando para envolver com IF...END-IF
	context.subscriptions.push(
		vscode.commands.registerCommand('zcobol-validation.wrapWithIf', async (document, lineNumber) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			const line = document.lineAt(lineNumber);
			const lineText = line.text;
			const indentation = lineText.substring(0, lineText.search(/\S|$/));

			// Obtém a condição padrão das configurações
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

			// Posiciona o cursor após "IF " na linha do IF para preencher a condição
			const newPosition = new vscode.Position(lineNumber, indentation.length + 3);
			editor.selection = new vscode.Selection(newPosition, newPosition);

			// Insere um snippet com a condição padrão ou placeholder
			const snippetText = defaultCondition ? `\${1:${defaultCondition}}` : '${1:condição}';
			await editor.insertSnippet(
				new vscode.SnippetString(snippetText),
				newPosition
			);
		})
	);

	// Regista o comando para criar constante
	context.subscriptions.push(
		vscode.commands.registerCommand('zcobol-validation.createConstant', async (document, range, hardcodedValue, valueType) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			// Procura se já existe uma constante com o mesmo valor
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
						console.log(`Constante existente encontrada: ${constName} com valor ${constValue}`);
						break;
					}
				}
			}

			if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
				break;
			}
		}

		// Se encontrou uma constante existente, usa essa
		if (existingConstant) {
			const useExisting = await vscode.window.showInformationMessage(
				`Já existe a constante '${existingConstant}' com este valor. Deseja usá-la?`,
				'Sim', 'Não, criar nova'
			);

			if (useExisting === 'Sim') {
				// Substitui o valor hardcoded pela constante existente
				await editor.edit(editBuilder => {
					editBuilder.replace(range, existingConstant);
				});
				return;
			}
			// Se escolheu "Não, criar nova", continua para criar uma nova constante
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

		// Pede ao usuário o nome da constante com sugestão padrão
		const constantName = await vscode.window.showInputBox({
			prompt: 'Nome da constante',
			value: defaultName,
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return 'O nome da constante não pode estar vazio';
				}
				if (!/^[A-Z][A-Z0-9-]*$/i.test(value)) {
					return 'O nome deve começar com letra e conter apenas letras, números e hífens';
				}
			return null;
		}
	});

	if (!constantName) {
		return; // Usuário cancelou
	}

	// Verifica se encontrou WORKING-STORAGE SECTION
	if (workingStorageLine < 0) {
		vscode.window.showErrorMessage('WORKING-STORAGE SECTION não encontrada no documento.');
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

	// Insere a declaração da constante na WORKING-STORAGE SECTION
	await editor.edit(editBuilder => {
		const insertLine = lastCompleteVarLine >= 0 ? lastCompleteVarLine + 1 : workingStorageLine + 1;
		const constantDecl = `       01  ${constantName.padEnd(28)} ${picClause} VALUE ${valueClause}.\n`;
		editBuilder.insert(new vscode.Position(insertLine, 0), constantDecl);

		// Substitui o valor hardcoded pelo nome da constante
		editBuilder.replace(range, constantName);
	});
})
	);

	// Valida quando o documento é modificado
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			validateCobolDocument(event.document);
		})
	);

	// Valida quando muda o editor ativo
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				validateCobolDocument(editor.document);
			}
		})
	);

	// Valida todos os documentos abertos
	vscode.workspace.textDocuments.forEach(document => {
		validateCobolDocument(document);
	});

	// Re-valida todos os documentos quando a configuração muda
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('zcobol-validation.enableUnusedVariableCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableUnprotectedDisplayCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableGoToCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableUnmatchedIfCheck') ||
			    event.affectsConfiguration('zcobol-validation.enableHardcodedCheck')) {
				console.log('Configuração alterada - revalidando todos os documentos');
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
