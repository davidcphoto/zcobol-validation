
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// Debug flag - desativado por padrão para melhor performance
const DEBUG_MODE = false;
const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

// Diagnostic collection for unused variable warnings
let diagnosticCollection;

// Debounce timers para evitar validação excessiva
const validationTimers = new Map();
const VALIDATION_DELAY = 500; // ms

// Cache para resultados de validação
const validationCache = new Map();

/**
 * Gera hash simples do texto para cache
 * @param {string} text
 * @returns {number}
 */
function simpleHash(text) {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash;
}

/**
 * Detecta se o ficheiro COBOL usa formato tradicional com números de sequência
 * @param {string} text - O texto completo do documento
 * @returns {boolean} - true se usa formato tradicional (colunas 1-6 com números)
 */
function hasSequenceNumbers(text) {
	const lines = text.split('\n');
	let linesWithNumbers = 0;
	let nonEmptyLines = 0;

	// Verifica as primeiras 50 linhas não vazias (ou menos se o arquivo for pequeno)
	for (let i = 0; i < Math.min(lines.length, 100); i++) {
		const line = lines[i];
		if (line.trim().length === 0) continue;

		nonEmptyLines++;
		if (nonEmptyLines > 50) break;

		// Se a linha tem pelo menos 6 caracteres e os primeiros 6 são todos dígitos
		if (line.length >= 6 && /^\d{6}/.test(line)) {
			linesWithNumbers++;
		}
	}

	// Se mais de 70% das linhas têm números de sequência, considera formato tradicional
	const hasSeqNum = nonEmptyLines > 0 && (linesWithNumbers / nonEmptyLines) > 0.7;
	console.log(`[zCobol] Detecção de formato: ${linesWithNumbers}/${nonEmptyLines} linhas com números = ${hasSeqNum ? 'TRADICIONAL' : 'LIVRE'}`);
	return hasSeqNum;
}

/**
 * Extrai a área de código válida de uma linha COBOL.
 * No formato COBOL tradicional:
 * - Colunas 1-6: Número de sequência (ignorado)
 * - Coluna 7: Indicador (*, /, D, -, ou espaço)
 * - Colunas 8-72: Área de código (única área válida)
 * - Colunas 73-80: Identificação (ignorada)
 * No formato livre: usa a linha toda
 *
 * @param {string} line - A linha completa do código COBOL
 * @param {boolean} useTraditionalFormat - Se true, usa formato tradicional com colunas
 * @returns {string} - O conteúdo da área de código
 */
function getCobolCodeArea(line, useTraditionalFormat = true) {
	if (!useTraditionalFormat) {
		// Formato livre - usa a linha toda
		return line;
	}

	// Formato tradicional
	// Se a linha tem menos de 8 caracteres, não há área de código
	if (line.length < 8) {
		return '';
	}

	// Extrai colunas 8-72 (índices 7-71 em JavaScript, base-0)
	// Se a linha for menor que 72 colunas, pega até o final
	const endIndex = Math.min(line.length, 72);
	return line.substring(7, endIndex);
}

/**
 * Verifica se uma linha COBOL é um comentário
 * @param {string} line - A linha completa do código COBOL
 * @param {boolean} useTraditionalFormat - Se true, usa formato tradicional (coluna 7 = '*' ou '/')
 * @returns {boolean} - true se a linha é um comentário
 */
function isCobolComment(line, useTraditionalFormat = true) {
	if (!useTraditionalFormat) {
		// Formato livre - comentário começa com * no início (após whitespace)
		return /^\s*\*/.test(line);
	}

	// Formato tradicional
	if (line.length < 7) {
		return false;
	}
	const indicator = line[6]; // Coluna 7 (índice 6)
	return indicator === '*' || indicator === '/';
}

/**
 * Calcula o offset da coluna baseado no formato
 * @param {boolean} useTraditionalFormat
 * @returns {number} - Offset a adicionar ao índice do match para obter a coluna real
 */
function getColumnOffset(useTraditionalFormat) {
	return useTraditionalFormat ? 7 : 0;
}

/**
 * Verifica se uma linha é PROCEDURE DIVISION
 * @param {string} line
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */
function isProcedureDivision(line, useTraditionalFormat = true) {
	const codeArea = getCobolCodeArea(line, useTraditionalFormat);
	return /^\s*PROCEDURE\s+DIVISION/i.test(codeArea);
}

/**
 * Verifica se uma linha é DATA DIVISION
 * @param {string} line
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */
function isDataDivision(line, useTraditionalFormat = true) {
	const codeArea = getCobolCodeArea(line, useTraditionalFormat);
	return /^\s*DATA\s+DIVISION/i.test(codeArea);
}

/**
 * Verifica se uma linha é WORKING-STORAGE SECTION
 * @param {string} line
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */
function isWorkingStorageSection(line, useTraditionalFormat = true) {
	const codeArea = getCobolCodeArea(line, useTraditionalFormat);
	return /^\s*WORKING-STORAGE\s+SECTION/i.test(codeArea);
}

/**
 * Verifica se uma linha é LINKAGE SECTION
 * @param {string} line
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */
function isLinkageSection(line, useTraditionalFormat = true) {
	const codeArea = getCobolCodeArea(line, useTraditionalFormat);
	return /^\s*LINKAGE\s+SECTION/i.test(codeArea);
}

/**
 * Verifica se uma linha é FILE-CONTROL
 * @param {string} line
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */


// Função reservada para otimizações futuras - parsing centralizado
/*
function parseCobolDocument(text) {
	const lines = text.split('\n');
	const sections = {
		dataDivisionStart: -1,
		workingStorageStart: -1,
		linkageSectionStart: -1,
		procedureDivisionStart: -1,
		fileControlStart: -1
	};

	// Identifica as seções principais em uma única passagem
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (/^\s*DATA\s+DIVISION/i.test(line)) {
			sections.dataDivisionStart = i;
		} else if (/^\s*WORKING-STORAGE\s+SECTION/i.test(line)) {
			sections.workingStorageStart = i;
		} else if (/^\s*LINKAGE\s+SECTION/i.test(line)) {
			sections.linkageSectionStart = i;
		} else if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			sections.procedureDivisionStart = i;
		} else if (/^\s*FILE-CONTROL/i.test(line)) {
			sections.fileControlStart = i;
		}
	}

	return {
		lines,
		sections,
		text
	};
}
*/

/**
 * Verifica se o documento é um ficheiro COBOL
 * @param {vscode.TextDocument} document
 * @returns {boolean}
 */
function isCobolFile(document) {
	// Verifica primeiro o languageId (mais confiável)
	if (document.languageId === 'cobol' || document.languageId === 'COBOL') {
		return true;
	}

	// Verifica extensão do ficheiro (funciona com URIs locais e remotos)
	const cobolExtensions = ['.cbl', '.cob', '.cobol', '.cpy'];
	const fileName = document.fileName ? document.fileName.toLowerCase() : '';
	const uriPath = document.uri.path ? document.uri.path.toLowerCase() : '';

	return cobolExtensions.some(ext => fileName.endsWith(ext) || uriPath.endsWith(ext));
}

/**
 * Verifica se uma variável é um grupo (não tem PIC e tem sub-variáveis)
 * @param {string[]} lines
 * @param {number} varLine
 * @param {number} varLevel
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */
function isGroupVariable(lines, varLine, varLevel, useTraditionalFormat = true) {
	const currentLine = lines[varLine];
	const currentCodeArea = getCobolCodeArea(currentLine, useTraditionalFormat);

	// Se a linha tem PIC, VALUE, ou USAGE, não é um grupo
	if (/\bPIC\b|\bPICTURE\b|\bVALUE\b|\bUSAGE\b/i.test(currentCodeArea)) {
		return false;
	}

	// Se a próxima linha é um COPY, considera como grupo (variável estrutural)
	if (varLine + 1 < lines.length) {
		const nextLine = lines[varLine + 1];
		const nextCodeArea = getCobolCodeArea(nextLine, useTraditionalFormat);
		if (/^\s*COPY\s+/i.test(nextCodeArea)) {
			return true;
		}
	}

	// Verifica se a próxima linha (ou linhas) tem uma variável de nível maior
	for (let i = varLine + 1; i < lines.length; i++) {
		const line = lines[i];

		// Ignora comentários
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		// Se encontrar outra divisão, para
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			break;
		}

		// Procura declaração de variável
		const codeArea = getCobolCodeArea(line, useTraditionalFormat);
		const nextVarMatch = codeArea.match(/^\s*(01|0[2-9]|[1-4][0-9]|77|88)\s+/i);
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
 * Extrai os níveis 88 associados a uma variável
 * @param {string[]} lines
 * @param {number} varLine
 * @param {number} varLevel
 * @returns {string[]}
 */
function extractLevel88Conditions(lines, varLine, varLevel, useTraditionalFormat = true) {
	const conditions = [];

	// Procura níveis 88 nas linhas seguintes à declaração da variável
	for (let i = varLine + 1; i < lines.length; i++) {
		const line = lines[i];

		// Ignora comentários
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		// Verifica se é uma declaração de nível
		const codeArea = getCobolCodeArea(line, useTraditionalFormat);
		const levelMatch = codeArea.match(/^\s*(01|0[2-9]|[1-4][0-9]|77|88)\s+([A-Z0-9][\w-]*)/i);
		if (levelMatch) {
			const level = parseInt(levelMatch[1]);
			const name = levelMatch[2].toUpperCase();

			// Se é nível 88, adiciona à lista
			if (level === 88) {
				conditions.push(name);
				debugLog(`Nível 88 encontrado: ${name} associado à variável na linha ${varLine}`);
			}
			// Se é um nível igual ou menor que a variável, já saímos do escopo da variável
			else if (level <= varLevel) {
				break;
			}
		}

		// Se encontrar outra divisão, para
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			break;
		}
	}

	return conditions;
}

/**
 * Extrai todos os níveis 88 declarados no código COBOL
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Map<string, {line: number, column: number, isLinkage: boolean}>}
 */
function extractLevel88Declarations(text, useTraditionalFormat = true) {
	const level88s = new Map();
	const lines = text.split('\n');

	let inDataDivision = false;
	let inLinkageSection = false;
	let inProcedureDivision = false;
	let lastParentVar = null; // Rastreia a última variável pai (para verificar se é FILLER)
	let lastParentLevel = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da DATA DIVISION
		if (isDataDivision(line, useTraditionalFormat)) {
			inDataDivision = true;
			inProcedureDivision = false;
			continue;
		}

		// Detecta início da LINKAGE SECTION
		if (isLinkageSection(line, useTraditionalFormat)) {
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

		// Se estamos na DATA DIVISION, procura declarações de nível 88
		if (inDataDivision && !inProcedureDivision) {
			// Ignora comentários
			if (isCobolComment(line, useTraditionalFormat)) {
				continue;
			}

			// Verifica se é uma declaração de variável (não nível 88)
			const codeArea = getCobolCodeArea(line, useTraditionalFormat);
			const varMatch = codeArea.match(/^\s*(01|0[2-9]|[1-4][0-9]|77)\s+([A-Z0-9][\w-]*)/i);
			if (varMatch) {
				lastParentLevel = parseInt(varMatch[1]);
				lastParentVar = varMatch[2].toUpperCase();
				debugLog(`Variável pai rastreada: ${lastParentVar} (nível ${lastParentLevel})`);
			}

			// Procura declarações de nível 88
			const level88Match = codeArea.match(/^\s*88\s+([A-Z0-9][\w-]*)/i);
			if (level88Match) {
				const conditionName = level88Match[1].toUpperCase();

				// Ignora níveis 88 de variáveis FILLER
				if (lastParentVar && (lastParentVar === 'FILLER' || lastParentVar.startsWith('FILLER-'))) {
					debugLog(`Nível 88 ${conditionName} ignorado (associado a FILLER: ${lastParentVar})`);
					continue;
				}

				const column = line.indexOf(level88Match[1]);

				level88s.set(conditionName, {
					line: i,
					column: column,
					isLinkage: inLinkageSection
				});
				debugLog(`Nível 88 declarado: ${conditionName} na linha ${i}`);
			}
		}
	}

	return level88s;
}

/**
 * Verifica se um nível 88 é utilizado no código
 * @param {string} text
 * @param {string} conditionName
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */
function isLevel88Used(text, conditionName, useTraditionalFormat = true) {
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let inDataDivision = false;
	let procedureDivisionStartLine = -1;
	let inExecBlock = false;
	let execBlockContent = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da DATA DIVISION
		if (isDataDivision(line, useTraditionalFormat)) {
			inDataDivision = true;
			inProcedureDivision = false;
			continue;
		}

		// Detecta início da PROCEDURE DIVISION
		if (isProcedureDivision(line, useTraditionalFormat)) {
			inProcedureDivision = true;
			inDataDivision = false;
			procedureDivisionStartLine = i;
			continue;
		}

		// Procura uso do nível 88 na DATA DIVISION (blocos EXEC em WORKING-STORAGE) ou PROCEDURE DIVISION
		if (inDataDivision || (inProcedureDivision && i > procedureDivisionStartLine)) {
			// Ignora comentários
			if (isCobolComment(line, useTraditionalFormat)) {
				continue;
			}

			// Ignora a linha de declaração (na DATA DIVISION)
			const codeArea = getCobolCodeArea(line, useTraditionalFormat);
			const isDeclaration = codeArea.match(/^\s*88\s+/i);
			if (isDeclaration) {
				continue;
			}

			// Detecta início de blocos EXEC SQL ou EXEC CICS
			if (/EXEC\s+(SQL|CICS)/i.test(codeArea)) {
				inExecBlock = true;
				execBlockContent = codeArea;
			} else if (inExecBlock) {
				// Adiciona linha ao conteúdo do bloco
				execBlockContent += ' ' + codeArea.trim();
			}

			// Detecta fim de bloco EXEC
			if (inExecBlock && /END-EXEC/i.test(codeArea)) {
				// Verifica se o nível 88 está no bloco EXEC
				// Em SQL pode usar :VARIAVEL (host variable), então verificamos ambos os formatos
				const regex = new RegExp('(:?' + conditionName.replace(/-/g, '\\-') + ')\\b', 'i');
				if (regex.test(execBlockContent)) {
					debugLog(`Nível 88 ${conditionName} encontrado em bloco EXEC na linha ${i}: ${execBlockContent.substring(0, 100)}...`);
					return true;
				}

				// Reset do bloco
				inExecBlock = false;
				execBlockContent = '';
				// Não continuar verificando esta linha - já processamos o bloco
				continue;
			}

			// Se estiver dentro de bloco EXEC, não faz verificação regular
			// Aguarda até o END-EXEC para processar o bloco completo
			if (inExecBlock) {
				continue;
			}

			// Procura o nível 88 como palavra completa na área de código
			const regex = new RegExp('\\b' + conditionName.replace(/-/g, '\\-') + '\\b', 'i');
			if (regex.test(codeArea)) {
				debugLog(`Nível 88 ${conditionName} encontrado na linha ${i}: ${codeArea.trim()}`);
				return true;
			}
		}
	}

	return false;
}

/**
 * Extrai variáveis declaradas no código COBOL
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Map<string, {line: number, column: number, isLinkage: boolean, level88Conditions: string[]}>}
 */
function extractDeclaredVariables(text, useTraditionalFormat = true) {
	const variables = new Map();
	const lines = text.split('\n');

	debugLog('[zCobol extractDeclaredVariables] useTraditionalFormat:', useTraditionalFormat);
	debugLog('[zCobol extractDeclaredVariables] Total de linhas:', lines.length);

	let inDataDivision = false;
	let inLinkageSection = false;
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];


		// Detecta início da DATA DIVISION
		if (isDataDivision(line, useTraditionalFormat)) {
			inDataDivision = true;
			inProcedureDivision = false;
			debugLog('[zCobol extractDeclaredVariables] DATA DIVISION encontrada na linha', i);
			continue;
		}

		// Detecta início da LINKAGE SECTION
		if (isLinkageSection(line, useTraditionalFormat)) {
			inLinkageSection = true;
			debugLog('[zCobol extractDeclaredVariables] LINKAGE SECTION encontrada na linha', i);
			continue;
		}

		// Detecta início de outras seções (sai da LINKAGE SECTION)
		const codeArea = getCobolCodeArea(line, useTraditionalFormat);
		if (inDataDivision && /^\s*(WORKING-STORAGE|FILE|LOCAL-STORAGE|SCREEN|REPORT)\s+SECTION/i.test(codeArea)) {
			inLinkageSection = false;
			debugLog('[zCobol extractDeclaredVariables] Outra seção encontrada na linha', i);
			continue;
		}

		// Detecta início da PROCEDURE DIVISION
		if (isProcedureDivision(line, useTraditionalFormat)) {
			inDataDivision = false;
			inLinkageSection = false;
			inProcedureDivision = true;
			debugLog('[zCobol extractDeclaredVariables] PROCEDURE DIVISION encontrada na linha', i);
			continue;
		}

		// Se estamos na DATA DIVISION, procura declarações de variáveis
		if (inDataDivision && !inProcedureDivision) {
			// Ignora comentários
			if (isCobolComment(line, useTraditionalFormat)) {
				continue;
			}

			// Procura por declarações de variáveis (nível 01-49, 77, 88)
			const codeArea = getCobolCodeArea(line, useTraditionalFormat);
			const varMatch = codeArea.match(/^\s*(01|0[2-9]|[1-4][0-9]|77)\s+([A-Z0-9][\w-]*)/i);
			if (varMatch) {
				const varLevel = parseInt(varMatch[1]);
				const varName = varMatch[2].toUpperCase();
				debugLog('[zCobol extractDeclaredVariables] Variável encontrada:', varName, 'nível', varLevel, 'linha', i);

				// Ignora FILLER e palavras reservadas comuns
				if (varName !== 'FILLER' && !varName.startsWith('FILLER-')) {
					// Ignora variáveis de grupo (que não têm PIC e têm sub-variáveis)
					const isGroup = isGroupVariable(lines, i, varLevel, useTraditionalFormat);
					debugLog('[zCobol extractDeclaredVariables]', varName, 'é grupo?', isGroup);
					if (!isGroup) {
						const column = line.indexOf(varMatch[2]);
						// Extrai as condições de nível 88 associadas a esta variável
						const level88Conditions = extractLevel88Conditions(lines, i, varLevel, useTraditionalFormat);

						variables.set(varName, {
							line: i,
							column: column,
							isLinkage: inLinkageSection,
							level88Conditions: level88Conditions
						});
						debugLog('[zCobol extractDeclaredVariables] Variável adicionada:', varName);
					} else {
						debugLog(`[zCobol extractDeclaredVariables] Variável ${varName} é um grupo - ignorada`);
					}
				} else {
					debugLog('[zCobol extractDeclaredVariables] FILLER ignorado:', varName);
				}
			}
		}
	}

	debugLog('[zCobol extractDeclaredVariables] Total de variáveis extraídas:', variables.size);
	return variables;
}

/**
 * Verifica se uma variável é utilizada no código
 * @param {string} text
 * @param {string} varName
 * @param {number} declarationLine - Linha onde a variável foi declarada (para ignorar)
 * @param {boolean} isLinkage - Se true, verifica uso também na LINKAGE SECTION
 * @param {string[]} level88Conditions - Condições de nível 88 associadas à variável
 * @param {boolean} useTraditionalFormat
 * @returns {boolean}
 */
function isVariableUsed(text, varName, declarationLine = -1, isLinkage = false, level88Conditions = [], useTraditionalFormat = true) {
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let inLinkageSection = false;
	let inDataDivision = false;
	let procedureDivisionStartLine = -1;
	let linkageSectionStartLine = -1;
	let inExecBlock = false;
	let execBlockContent = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da DATA DIVISION
		if (isDataDivision(line, useTraditionalFormat)) {
			inDataDivision = true;
			inProcedureDivision = false;
			continue;
		}

		// Detecta início da LINKAGE SECTION
		if (isLinkageSection(line, useTraditionalFormat)) {
			inLinkageSection = true;
			linkageSectionStartLine = i;
			continue;
		}

		// Detecta início de outras seções (sai da LINKAGE SECTION)
		const codeArea = getCobolCodeArea(line, useTraditionalFormat);
		if (inDataDivision && /^\s*(WORKING-STORAGE|FILE|LOCAL-STORAGE|SCREEN|REPORT)\s+SECTION/i.test(codeArea)) {
			inLinkageSection = false;
			continue;
		}

		// Detecta início da PROCEDURE DIVISION
		if (isProcedureDivision(line, useTraditionalFormat)) {
			inProcedureDivision = true;
			inLinkageSection = false;
			inDataDivision = false;
			procedureDivisionStartLine = i;
			debugLog(`PROCEDURE DIVISION encontrada na linha ${i}`);
			continue;
		}

		// Procura uso da variável na DATA DIVISION (blocos EXEC em WORKING-STORAGE) ou PROCEDURE DIVISION
		if (inDataDivision || (inProcedureDivision && i > procedureDivisionStartLine)) {
			// Ignora a linha de declaração da variável
			if (i === declarationLine) {
				continue;
			}

			// Ignora comentários
			if (isCobolComment(line, useTraditionalFormat)) {
				continue;
			}

			// Extrai área de código
			const codeArea = getCobolCodeArea(line, useTraditionalFormat);

			// Detecta início de blocos EXEC SQL ou EXEC CICS
			if (/EXEC\s+(SQL|CICS)/i.test(codeArea)) {
				inExecBlock = true;
				execBlockContent = codeArea;
			} else if (inExecBlock) {
				// Adiciona linha ao conteúdo do bloco
				execBlockContent += ' ' + codeArea.trim();
			}

			// Detecta fim de bloco EXEC
			if (inExecBlock && /END-EXEC/i.test(codeArea)) {
				// Verifica se a variável está no bloco EXEC
				// Em SQL usa-se :VARIAVEL (host variable), então verificamos ambos os formatos
				const regex = new RegExp('(:?' + varName.replace(/-/g, '\\-') + ')\\b', 'i');
				if (regex.test(execBlockContent)) {
					debugLog(`Variável ${varName} encontrada em bloco EXEC na linha ${i}: ${execBlockContent.substring(0, 100)}...`);
					return true;
				}

				// Verifica se alguma das condições de nível 88 é usada no bloco EXEC
				for (const condition of level88Conditions) {
					const conditionRegex = new RegExp('(:?' + condition.replace(/-/g, '\\-') + ')\\b', 'i');
					if (conditionRegex.test(execBlockContent)) {
						debugLog(`Condição nível 88 ${condition} da variável ${varName} encontrada em bloco EXEC na linha ${i}`);
						return true;
					}
				}

				// Reset do bloco
				inExecBlock = false;
				execBlockContent = '';
				// Não continuar verificando esta linha - já processamos o bloco
				continue;
			}

			// Se estiver dentro de bloco EXEC, não faz verificação regular
			// Aguarda até o END-EXEC para processar o bloco completo
			if (inExecBlock) {
				continue;
			}

			// Procura a variável como palavra completa (não parte de outra palavra)
			const regex = new RegExp('\\b' + varName.replace(/-/g, '\\-') + '\\b', 'i');
			if (regex.test(codeArea)) {
				debugLog(`Variável ${varName} encontrada na linha ${i}: ${codeArea.trim()}`);
				return true;
			}

			// Verifica se alguma das condições de nível 88 é usada
			for (const condition of level88Conditions) {
				const conditionRegex = new RegExp('\\b' + condition.replace(/-/g, '\\-') + '\\b', 'i');
				if (conditionRegex.test(codeArea)) {
					debugLog(`Condição nível 88 ${condition} da variável ${varName} encontrada na linha ${i}: ${codeArea.trim()}`);
					return true;
				}
			}
		}

		// Se é variável da LINKAGE SECTION, verifica uso também na própria LINKAGE SECTION
		if (isLinkage && inLinkageSection && i > linkageSectionStartLine) {
			// Ignora comentários
			if (isCobolComment(line, useTraditionalFormat)) {
				continue;
			}

			// Ignora a linha de declaração da própria variável
			const codeArea = getCobolCodeArea(line, useTraditionalFormat);
			const isDeclaration = codeArea.match(new RegExp('^\\s*(01|0[2-9]|[1-4][0-9]|77)\\s+' + varName.replace(/-/g, '\\-') + '\\b', 'i'));
			if (isDeclaration) {
				continue;
			}

			// Procura a variável como palavra completa (não parte de outra palavra)
			const regex = new RegExp('\\b' + varName.replace(/-/g, '\\-') + '\\b', 'i');
			if (regex.test(codeArea)) {
				debugLog(`Variável ${varName} encontrada na LINKAGE SECTION na linha ${i}: ${codeArea.trim()}`);
				return true;
			}

			// Verifica se alguma das condições de nível 88 é usada na LINKAGE SECTION
			for (const condition of level88Conditions) {
				const conditionRegex = new RegExp('\\b' + condition.replace(/-/g, '\\-') + '\\b', 'i');
				if (conditionRegex.test(codeArea)) {
					debugLog(`Condição nível 88 ${condition} da variável ${varName} encontrada na LINKAGE SECTION na linha ${i}: ${codeArea.trim()}`);
					return true;
				}
			}
		}
	}

	return false;
}

/**
 * Verifica displays não protegidos (fora de blocos IF e EVALUATE)
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Array<{line: number, column: number, length: number}>}
 */
function findUnprotectedDisplays(text, useTraditionalFormat = true) {
	const displays = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let ifNestingLevel = 0;
	let evaluateNestingLevel = 0;

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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		// Detecta início de IF
		const codeArea = getCobolCodeArea(line, useTraditionalFormat);
		if (/^\s*IF\s+/i.test(codeArea)) {
			ifNestingLevel++;
			debugLog(`IF encontrado na linha ${i}, nível: ${ifNestingLevel}`);
		}

		// Detecta fim de IF
		if (/^\s*END-IF/i.test(codeArea)) {
			if (ifNestingLevel > 0) {
				ifNestingLevel--;
			}
			debugLog(`END-IF encontrado na linha ${i}, nível: ${ifNestingLevel}`);
		}

		// Detecta início de EVALUATE
		if (/^\s*EVALUATE\s+/i.test(codeArea)) {
			evaluateNestingLevel++;
			debugLog(`EVALUATE encontrado na linha ${i}, nível: ${evaluateNestingLevel}`);
		}

		// Detecta fim de EVALUATE
		if (/^\s*END-EVALUATE/i.test(codeArea)) {
			if (evaluateNestingLevel > 0) {
				evaluateNestingLevel--;
			}
			debugLog(`END-EVALUATE encontrado na linha ${i}, nível: ${evaluateNestingLevel}`);
		}

		// Detecta DISPLAY fora de blocos IF e EVALUATE
		const displayMatch = codeArea.match(/^\s*(DISPLAY\s+)/i);
		if (displayMatch && ifNestingLevel === 0 && evaluateNestingLevel === 0) {
			const column = line.indexOf(displayMatch[1]);
			displays.push({
				line: i,
				column: column,
				length: displayMatch[1].trim().length
			});
			debugLog(`DISPLAY não protegido encontrado na linha ${i}`);
		}
	}

	return displays;
}

/**
 * Verifica uso de símbolos (<, >, =) em condições IF e WHEN
 * @param {string} text
 * @param {boolean} useShortForm - Se true, usa LESS OR EQUAL e GREATER OR EQUAL em vez das formas longas
 * @param {boolean} useTraditionalFormat - Se true, usa formato COBOL tradicional com colunas
 * @returns {Array<{line: number, column: number, length: number, operator: string, replacement: string}>}
 */
function findSymbolicOperatorsInIf(text, useShortForm = false, useTraditionalFormat = true) {
	const operators = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;
	const columnOffset = getColumnOffset(useTraditionalFormat);

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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const lineContent = getCobolCodeArea(line, useTraditionalFormat);

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
				if (isCobolComment(nextLine, useTraditionalFormat)) {
					currentIndex++;
					continue;
				}

				const nextLineContent = getCobolCodeArea(nextLine, useTraditionalFormat);

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
				console.log('[zCobol]   Processando condição linha', lineIndex);
				console.log('[zCobol]     Original:', content);
				console.log('[zCobol]     Sem strings:', lineWithoutStrings);

				// Procura cada tipo de operador
				for (const pattern of symbolPatterns) {
					const matches = [...lineWithoutStrings.matchAll(pattern.regex)];
					for (const match of matches) {
						const matchIndex = match.index;
						const column = columnOffset + matchIndex;
						operators.push({
							line: lineIndex,
							column: column,
							length: pattern.operator.length,
							operator: pattern.operator,
							replacement: pattern.replacement
						});
						debugLog(`Operador simbólico '${pattern.operator}' encontrado na linha ${lineIndex}`);
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
function findGoToStatements(text, useTraditionalFormat = true) {
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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		// Detecta GO TO (com ou sem espaço: "GO TO" ou "GOTO")
		const lineContent = getCobolCodeArea(line, useTraditionalFormat);
		const gotoMatch = lineContent.match(/^\s*(GO\s*TO\s+([A-Z0-9][\w-]*))/i);
		if (gotoMatch) {
			const column = line.indexOf(gotoMatch[1]);
			const target = gotoMatch[2] || '';
			gotos.push({
				line: i,
				column: column,
				length: gotoMatch[1].trim().length,
				target: target
			});
			debugLog(`GO TO encontrado na linha ${i} para ${target}`);
		}
	}

	return gotos;
}

/**
 * Verifica IFs sem END-IF correspondente
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Array<{line: number, column: number, length: number}>}
 */
function findUnmatchedIfs(text, useTraditionalFormat = true) {
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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const lineContent = getCobolCodeArea(line, useTraditionalFormat);

		// Detecta IF (mas não END-IF)
		const ifMatch = lineContent.match(/^\s*(IF\s+)/i);
		if (ifMatch && !/^\s*END-IF/i.test(lineContent)) {
			// Verifica se o END-IF está na mesma linha (até o ponto final)
			const dotIndex = lineContent.indexOf('.');
			const contentUntilDot = dotIndex !== -1 ? lineContent.substring(0, dotIndex) : lineContent;
			const hasEndIfInSameLine = /\bEND-IF\b/i.test(contentUntilDot);

			if (!hasEndIfInSameLine) {
				const column = line.indexOf(ifMatch[1]);
				ifStack.push({
					line: i,
					column: column,
					length: ifMatch[1].trim().length
				});
				debugLog(`IF encontrado na linha ${i}, stack size: ${ifStack.length}`);
			} else {
				debugLog(`IF com END-IF na mesma linha ${i}, ignorando`);
			}
		}

		// Detecta END-IF em linha separada
		if (/^\s*END-IF/i.test(lineContent)) {
			if (ifStack.length > 0) {
				ifStack.pop(); // Remove o IF correspondente
				debugLog(`END-IF encontrado na linha ${i}, stack size: ${ifStack.length}`);
			}
		}
	}

	// IFs que sobraram no stack não têm END-IF correspondente
	debugLog(`IFs sem END-IF: ${ifStack.length}`);
	return ifStack;
}

/**
 * Verifica IFs sem ELSE correspondente
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Array<{line: number, column: number, length: number}>}
 */
function findIfsWithoutElse(text, useTraditionalFormat = true) {
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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const lineContent = getCobolCodeArea(line, useTraditionalFormat);

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
				if (isCobolComment(nextLine, useTraditionalFormat)) {
					continue;
				}

				const nextLineContent = getCobolCodeArea(nextLine, useTraditionalFormat);

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
				debugLog(`IF sem ELSE encontrado na linha ${i}`);
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
function findEvaluatesWithoutWhenOther(text, useTraditionalFormat = true) {
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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const lineContent = getCobolCodeArea(line, useTraditionalFormat);

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
				if (isCobolComment(nextLine, useTraditionalFormat)) {
					continue;
				}

				const nextLineContent = getCobolCodeArea(nextLine, useTraditionalFormat);

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
				debugLog(`EVALUATE sem WHEN OTHER encontrado na linha ${i}`);
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
function findLowerCaseCode(text, useTraditionalFormat = true) {
	const lowerCaseCode = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;
	const columnOffset = getColumnOffset(useTraditionalFormat);

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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const lineContent = getCobolCodeArea(line, useTraditionalFormat);

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
				const column = columnOffset + matchIndex;
				lowerCaseCode.push({
					line: i,
					column: column,
					length: word.length,
					word: word
				});
				debugLog(`Código em minúsculas encontrado na linha ${i}: ${word}`);
			}
		}
	}

	return lowerCaseCode;
}

/**
 * Extrai declarações de ficheiros no código COBOL (SELECT statements)
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Map<string, {line: number, column: number}>}
 */
/*
 * VALIDAÇÕES DE FICHEIROS - DESATIVADAS
 *
 * As seguintes funções relacionadas com validação de operações de ficheiros
 * foram desativadas conforme solicitado.
 *
function extractFileDeclarations(text, useTraditionalFormat = true) {
	const files = new Map();
	const lines = text.split('\n');
	let inFileControl = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da FILE-CONTROL
		if (isFileControl(line, useTraditionalFormat)) {
			inFileControl = true;
			debugLog(`FILE-CONTROL encontrado na linha ${i}`);
			continue;
		}

		// Detecta fim da FILE-CONTROL (quando encontra outra seção ou divisão)
		const codeArea = getCobolCodeArea(line, useTraditionalFormat);
		if (inFileControl && /^\s*(I-O-CONTROL|DATA\s+DIVISION|PROCEDURE\s+DIVISION)/i.test(codeArea)) {
			inFileControl = false;
			debugLog(`Fim de FILE-CONTROL na linha ${i}`);
			continue;
		}

		// Se estamos na FILE-CONTROL, procura declarações SELECT
		if (inFileControl) {
			// Ignora comentários
			if (isCobolComment(line, useTraditionalFormat)) {
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
				debugLog(`Ficheiro declarado: ${fileName} na linha ${i}`);
			}
		}
	}

	return files;
}

function hasFileOperations(text, fileName, useTraditionalFormat = true) {
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
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const lineContent = getCobolCodeArea(line, useTraditionalFormat);

		// Verifica OPEN com o nome do ficheiro
		if (/^\s*OPEN\s+(INPUT|OUTPUT|I-O|EXTEND)/i.test(lineContent)) {
			if (fileNameRegex.test(lineContent)) {
				hasOpen = true;
				debugLog(`OPEN encontrado para ${fileName} na linha ${i}`);
			}
		}

		// Verifica CLOSE com o nome do ficheiro
		if (/^\s*CLOSE\s+/i.test(lineContent)) {
			if (fileNameRegex.test(lineContent)) {
				hasClose = true;
				debugLog(`CLOSE encontrado para ${fileName} na linha ${i}`);
			}
		}

		// Verifica READ com o nome do ficheiro
		if (/^\s*READ\s+/i.test(lineContent)) {
			if (fileNameRegex.test(lineContent)) {
				hasReadOrWrite = true;
				debugLog(`READ encontrado para ${fileName} na linha ${i}`);
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
				debugLog(`WRITE encontrado para ${fileName} na linha ${i}`);
			}
		}
	}

	return { hasOpen, hasClose, hasReadOrWrite };
}

function findFilesWithoutOperations(text, useTraditionalFormat = true) {
	const filesWithoutOps = [];
	const declaredFiles = extractFileDeclarations(text, useTraditionalFormat);

	for (const [fileName, position] of declaredFiles) {
		const operations = hasFileOperations(text, fileName, useTraditionalFormat);
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
			debugLog(`Ficheiro ${fileName} sem operações: ${missing.join(', ')}`);
		}
	}

	return filesWithoutOps;
}
*/

/**
 * Extrai declarações de cursores no código COBOL (DECLARE CURSOR)
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Map<string, {line: number, column: number}>}
 */
function extractCursorDeclarations(text, useTraditionalFormat = true) {
	const cursors = new Map();
	const lines = text.split('\n');
	let inExecSqlBlock = false;
	let execSqlContent = '';
	let execSqlStartLine = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Ignora comentários
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		// Detecta início de bloco EXEC SQL
		if (/EXEC\s+SQL/i.test(line)) {
			inExecSqlBlock = true;
			execSqlContent = line;
			execSqlStartLine = i;
			debugLog(`Início de bloco EXEC SQL na linha ${i}`);
		} else if (inExecSqlBlock) {
			// Adiciona linha ao conteúdo do bloco SQL
			execSqlContent += ' ' + line.trim();
		}

		// Detecta fim de bloco EXEC SQL
		if (inExecSqlBlock && /END-EXEC/i.test(line)) {
			debugLog(`Fim de bloco EXEC SQL na linha ${i}, conteúdo: ${execSqlContent.substring(0, 100)}...`);

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
				debugLog(`Cursor declarado: ${cursorName} na linha ${cursorLine}`);
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
 * @param {boolean} useTraditionalFormat
 * @returns {{hasOpen: boolean, hasFetch: boolean, hasClose: boolean}}
 */
function hasCursorOperations(text, cursorName, useTraditionalFormat = true) {
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
		if (isCobolComment(line, useTraditionalFormat)) {
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
				debugLog(`OPEN encontrado para cursor ${cursorName} na linha ${i}`);
			}

			// Verifica FETCH
			if (/\bFETCH\b/i.test(execSqlContent) && cursorNameRegex.test(execSqlContent)) {
				hasFetch = true;
				debugLog(`FETCH encontrado para cursor ${cursorName} na linha ${i}`);
			}

			// Verifica CLOSE
			if (/\bCLOSE\b/i.test(execSqlContent) && cursorNameRegex.test(execSqlContent)) {
				hasClose = true;
				debugLog(`CLOSE encontrado para cursor ${cursorName} na linha ${i}`);
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
 * @param {boolean} useTraditionalFormat
 * @returns {Array<{cursorName: string, line: number, column: number, missing: string[]}>}
 */
function findCursorsWithoutOperations(text, useTraditionalFormat = true) {
	const cursorsWithoutOps = [];
	const declaredCursors = extractCursorDeclarations(text, useTraditionalFormat);

	for (const [cursorName, position] of declaredCursors) {
		const operations = hasCursorOperations(text, cursorName, useTraditionalFormat);
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
			debugLog(`Cursor ${cursorName} sem operações: ${missing.join(', ')}`);
		}
	}

	return cursorsWithoutOps;
}

/**
 * Verifica valores hardcoded no código (strings e números literais)
 * @param {string} text
 * @param {boolean} enableInString
 * @param {boolean} enableInDisplay
 * @param {boolean} useTraditionalFormat
 * @returns {Array<{line: number, column: number, length: number, value: string, type: string}>}
 */
function findHardcodedValues(text, enableInString = false, enableInDisplay = false, useTraditionalFormat = true) {
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
		if (isProcedureDivision(line, useTraditionalFormat)) {
			inProcedureDivision = true;
			debugLog(`PROCEDURE DIVISION encontrada na linha ${i} de findHardcodedValues`);
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const lineContent = getCobolCodeArea(line, useTraditionalFormat);

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
			if (isCobolComment(nextLine, useTraditionalFormat)) {
				currentIndex++;
				continue;
			}

			const nextLineContent = getCobolCodeArea(nextLine, useTraditionalFormat);
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
				// Só valida se estiver até a coluna 72 (índice 71)
				if (column !== -1 && column <= 71) {
					hardcoded.push({
						line: lineIndex,
						column: column,
						length: value.length,
						value: value,
						type: 'string'
					});
					debugLog(`String hardcoded encontrada na linha ${lineIndex}: ${value}`);
				}
			}

			// Detecta números literais em comandos (MOVE, IF, COMPUTE, etc)
			// Mas não em declarações PIC ou dentro de reference modifications ou strings literais
			if (!/\bPIC\b|\bPICTURE\b/i.test(lineContent)) {
				debugLog(`Processando números na linha ${lineIndex}: ${lineContent.trim()}`);

				// Remove strings literais para não validar números dentro delas
				let tempLine = lineContent;

				// Remove strings entre aspas simples e duplas
				tempLine = tempLine.replace(/(['"])([^'"]*)\1/g, (match) => {
					// Substitui por espaços do mesmo tamanho para manter posições
					return ' '.repeat(match.length);
				});

				// Remove conteúdo de reference modifications mas mantém parênteses
				tempLine = tempLine.replace(/\(([^)]*:[^)]*)\)/g, (match, content) => {
					// Mantém os parênteses mas remove o conteúdo
					return '(' + ' '.repeat(content.length) + ')';
				});

				// Procura números isolados (inteiros ou decimais) na linha processada
				const numberRegex = /\b(\d+(?:\.\d+)?)\b/g;
				let match;

				while ((match = numberRegex.exec(tempLine)) !== null) {
					const value = match[1];
					const posInTemp = match.index;

					// Verifica contexto antes e depois na linha temporária
					const beforeChar = posInTemp > 0 ? tempLine[posInTemp - 1] : ' ';
					const afterChar = posInTemp + value.length < tempLine.length ? tempLine[posInTemp + value.length] : ' ';

					// Verifica se não faz parte de um identificador
					const isPartOfIdentifier = /[A-Z0-9-]/i.test(beforeChar) || /[A-Z0-9-]/i.test(afterChar);

					// Verifica se está dentro de parênteses (reference modification)
					const beforeContext = tempLine.substring(Math.max(0, posInTemp - 10), posInTemp);
					const afterContext = tempLine.substring(posInTemp + value.length, Math.min(tempLine.length, posInTemp + value.length + 10));
					const isInRefMod = /\([^)]*$/.test(beforeContext) && /^[^(]*[:)]/.test(afterContext);

					debugLog(`isPartOfIdentifier: ${isPartOfIdentifier}, isInRefMod: ${isInRefMod}`);

					if (!isPartOfIdentifier && !isInRefMod) {
						// A posição em tempLine é a mesma que em lineContent (mantivemos o tamanho)
						const fullColumn = line.indexOf(lineContent) + posInTemp;
						// Só valida se estiver até a coluna 72 (índice 71)
						if (fullColumn <= 71) {
							hardcoded.push({
								line: lineIndex,
								column: fullColumn,
								length: value.length,
								value: value,
								type: 'number'
							});
							debugLog(`Número hardcoded encontrado na linha ${lineIndex}: ${value}`);
						}
					}
				}
			}
		}
	}

	return hardcoded;
}

/**
 * Verifica declarações de variáveis na PROCEDURE DIVISION que deveriam estar na WORKING-STORAGE SECTION
 * @param {string} text
 * @param {boolean} useTraditionalFormat
 * @returns {Array<{line: number, column: number, length: number, varName: string}>}
 */
function findVariablesInProcedureDivision(text, useTraditionalFormat = true) {
	const variables = [];
	const lines = text.split('\n');
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (isProcedureDivision(line, useTraditionalFormat)) {
			inProcedureDivision = true;
			continue;
		}

		if (!inProcedureDivision) {
			continue;
		}

		// Ignora comentários
		if (isCobolComment(line, useTraditionalFormat)) {
			continue;
		}

		const codeArea = getCobolCodeArea(line, useTraditionalFormat);

		// Detecta declarações de variáveis (níveis 01-49, 77) com VALUE na PROCEDURE DIVISION
		// Padrão: nível + nome + PIC/PICTURE (opcional) + VALUE
		const varMatch = codeArea.match(/^\s*(01|0[2-9]|[1-4][0-9]|77)\s+([A-Z0-9][\w-]*)/i);
		if (varMatch) {
			const varName = varMatch[2].toUpperCase();

			// Verifica se tem PIC ou VALUE na mesma linha ou nas próximas
			let hasValueOrPic = /\b(PIC|PICTURE|VALUE)\b/i.test(codeArea);

			// Se não tem na linha atual, verifica próximas linhas (continuação)
			if (!hasValueOrPic && i < lines.length - 1) {
				for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
					const nextLine = lines[j];
					if (isCobolComment(nextLine, useTraditionalFormat)) {
						continue;
					}
					const nextCodeArea = getCobolCodeArea(nextLine, useTraditionalFormat);

					// Se encontrar outra declaração de nível, para
					if (/^\s*(01|0[2-9]|[1-4][0-9]|77|88)\s+/i.test(nextCodeArea)) {
						break;
					}

					if (/\b(PIC|PICTURE|VALUE)\b/i.test(nextCodeArea)) {
						hasValueOrPic = true;
						break;
					}

					// Se encontrar ponto final, para
					if (/\.\s*$/.test(nextCodeArea.trim())) {
						break;
					}
				}
			}

			// Se tem PIC ou VALUE, é uma declaração de constante/variável
			if (hasValueOrPic) {
				const column = line.indexOf(varMatch[0]);
				variables.push({
					line: i,
					column: column,
					length: varMatch[0].length,
					varName: varName
				});
				debugLog(`Variável ${varName} declarada na PROCEDURE DIVISION na linha ${i}`);
			}
		}
	}

	return variables;
}

/**
 * Valida o documento com debounce para evitar validações excessivas
 * @param {vscode.TextDocument} document
 */
function validateCobolDocumentDebounced(document) {
	const uri = document.uri.toString();

	// Limpa o timer anterior para este documento
	const existingTimer = validationTimers.get(uri);
	if (existingTimer) {
		clearTimeout(existingTimer);
	}

	// Cria novo timer
	const timer = setTimeout(() => {
		validateCobolDocument(document);
		validationTimers.delete(uri);
	}, VALIDATION_DELAY);

	validationTimers.set(uri, timer);
}

/**
 * Valida o documento COBOL e atualiza os diagnósticos
 * @param {vscode.TextDocument} document
 */
function validateCobolDocument(document) {
	if (!isCobolFile(document)) {
		return;
	}

	const text = document.getText();
	const uri = document.uri.toString();
	const contentHash = simpleHash(text);

	debugLog('[zCobol validateCobolDocument] Validando:', uri);
	debugLog('[zCobol validateCobolDocument] Hash do conteúdo:', contentHash);

	// Detecta se o ficheiro usa formato tradicional (com números de sequência)
	const useTraditionalFormat = hasSequenceNumbers(text);

	// Verifica cache - se o conteúdo não mudou, usa resultado em cache
	const cached = validationCache.get(uri);
	debugLog('[zCobol validateCobolDocument] Cache encontrado?', cached ? 'SIM' : 'NÃO');
	if (cached && cached.hash === contentHash) {
		debugLog('[zCobol validateCobolDocument] Usando cache (hash igual)');
		diagnosticCollection.set(document.uri, cached.diagnostics);
		return;
	}

	debugLog('[zCobol validateCobolDocument] Executando validação completa (cache inválido ou inexistente)');
	const diagnostics = [];
	const config = vscode.workspace.getConfiguration('zcobol-validation');

	// Parse único do documento (reservado para otimizações futuras)
	// const parsed = parseCobolDocument(text);

	// Validação de variáveis não utilizadas
	const enableUnusedVarCheck = config.get('enableUnusedVariableCheck', true);
	debugLog('[zCobol] enableUnusedVarCheck:', enableUnusedVarCheck);
	debugLog('[zCobol] useTraditionalFormat:', useTraditionalFormat);
	if (enableUnusedVarCheck) {
		const declaredVariables = extractDeclaredVariables(text, useTraditionalFormat);
		debugLog('[zCobol] Variáveis declaradas:', Array.from(declaredVariables.keys()));
		debugLog('[zCobol] Total de variáveis declaradas:', declaredVariables.size);

		// Verifica cada variável declarada
		for (const [varName, position] of declaredVariables) {
			const isUsed = isVariableUsed(text, varName, position.line, position.isLinkage, position.level88Conditions, useTraditionalFormat);
			debugLog(`Variável ${varName} (${position.isLinkage ? 'LINKAGE' : 'WORKING-STORAGE'}): ${isUsed ? 'USADA' : 'NÃO USADA'}`);

			// Se a variável tem níveis 88, mostra-os
			if (position.level88Conditions && position.level88Conditions.length > 0) {
				debugLog(`  Níveis 88: ${position.level88Conditions.join(', ')}`);
			}

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

	// Validação de níveis 88 não utilizados
	const enableUnusedLevel88Check = config.get('enableUnusedLevel88Check', true);
	if (enableUnusedLevel88Check) {
		const declaredLevel88s = extractLevel88Declarations(text, useTraditionalFormat);
		debugLog('Níveis 88 declarados:', Array.from(declaredLevel88s.keys()));

		// Verifica cada nível 88 declarado
		for (const [conditionName, position] of declaredLevel88s) {
			const isUsed = isLevel88Used(text, conditionName, useTraditionalFormat);
			debugLog(`Nível 88 ${conditionName}: ${isUsed ? 'USADO' : 'NÃO USADO'}`);

			if (!isUsed) {
				const range = new vscode.Range(
					position.line,
					position.column,
					position.line,
					position.column + conditionName.length
				);

				const diagnostic = new vscode.Diagnostic(
					range,
					`Level 88 condition '${conditionName}' is declared but not used`,
					vscode.DiagnosticSeverity.Warning
				);
				diagnostic.code = 'unused-level88';
				diagnostic.source = 'zCobol Validation';

				diagnostics.push(diagnostic);
			}
		}
	}

	// Validação de displays não protegidos
	const enableUnprotectedDisplayCheck = config.get('enableUnprotectedDisplayCheck', true);
	if (enableUnprotectedDisplayCheck) {
		const unprotectedDisplays = findUnprotectedDisplays(text, useTraditionalFormat);
		debugLog('Displays não protegidos encontrados:', unprotectedDisplays.length);

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
		const gotos = findGoToStatements(text, useTraditionalFormat);
		debugLog('Comandos GO TO encontrados:', gotos.length);

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
		const unmatchedIfs = findUnmatchedIfs(text, useTraditionalFormat);
		debugLog('IFs sem END-IF encontrados:', unmatchedIfs.length);

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
		debugLog('IFs sem ELSE encontrados:', ifsWithoutElse.length);

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
		debugLog('EVALUATE sem WHEN OTHER encontrados:', evaluatesWithoutWhenOther.length);

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
		const operatorFormat = /** @type {'long' | 'short'} */ (config.get('operatorFormat', 'long'));
		const useShortForm = operatorFormat === 'short';
		const symbolicOperators = findSymbolicOperatorsInIf(text, useShortForm, useTraditionalFormat);
		debugLog('Operadores simbólicos encontrados:', symbolicOperators.length);

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
		const hardcodedValues = findHardcodedValues(text, enableInString, enableInDisplay, useTraditionalFormat);
		debugLog('Valores hardcoded encontrados:', hardcodedValues.length);

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

	// Validação de variáveis declaradas na PROCEDURE DIVISION
	const enableVarsInProcedureCheck = config.get('enableVarsInProcedureCheck', true);
	if (enableVarsInProcedureCheck) {
		const varsInProcedure = findVariablesInProcedureDivision(text, useTraditionalFormat);
		debugLog('Variáveis declaradas na PROCEDURE DIVISION:', varsInProcedure.length);

		for (const varDecl of varsInProcedure) {
			const range = new vscode.Range(
				varDecl.line,
				varDecl.column,
				varDecl.line,
				varDecl.column + varDecl.length
			);

			const diagnostic = new vscode.Diagnostic(
				range,
				`Variable '${varDecl.varName}' declared in PROCEDURE DIVISION - constants should be declared in WORKING-STORAGE SECTION`,
				vscode.DiagnosticSeverity.Warning
			);
			diagnostic.code = 'variable-in-procedure';
			diagnostic.source = 'zCobol Validation';

			diagnostics.push(diagnostic);
		}
	}

	// Validação de código em minúsculas
	const enableLowerCaseCheck = config.get('enableLowerCaseCheck', false);
	if (enableLowerCaseCheck) {
		const lowerCaseCode = findLowerCaseCode(text, useTraditionalFormat);
		debugLog('Código em minúsculas encontrado:', lowerCaseCode.length);

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

	// Validação de operações de cursor (OPEN, FETCH, CLOSE)
	const enableCursorOperationsCheck = config.get('enableCursorOperationsCheck', true);
	if (enableCursorOperationsCheck) {
		const cursorsWithoutOps = findCursorsWithoutOperations(text, useTraditionalFormat);
		debugLog('Cursors without complete operations:', cursorsWithoutOps.length);

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

	console.log('[zCobol] Total de diagnósticos criados:', diagnostics.length);
	console.log('[zCobol] Diagnostics:', diagnostics.map(d => `${d.message} at line ${d.range.start.line}`));
	console.log('[zCobol] Chamando diagnosticCollection.set...');
	diagnosticCollection.set(document.uri, diagnostics);
	console.log('[zCobol] diagnosticCollection.set executado com sucesso');

	// Salva no cache
	validationCache.set(uri, {
		hash: contentHash,
		diagnostics: diagnostics
	});

	// Log para debug
	if (diagnostics.length > 0) {
		debugLog('Diagnósticos criados para:', document.uri.toString());
		debugLog('Primeiro diagnóstico:', {
			code: diagnostics[0].code,
			source: diagnostics[0].source,
			message: diagnostics[0].message,
			range: diagnostics[0].range
		});
	}
}

/**
 * Provedor de code actions para resolver warnings de variáveis não utilizadas
 */
class CobolCodeActionProvider {
	provideCodeActions(document, range, context) {
		debugLog('========================================');
		debugLog('provideCodeActions CHAMADO!');
		debugLog('Document:', document.uri.toString());
		debugLog('Range:', range);
		debugLog('Diagnósticos recebidos:', context.diagnostics.length);

		if (context.diagnostics.length > 0) {
			context.diagnostics.forEach((d, i) => {
				debugLog(`Diagnóstico ${i}:`, {
					source: d.source,
					code: d.code,
					message: d.message,
					severity: d.severity
				});
			});
		}

		const codeActions = [];

		// Procura por diagnósticos de variáveis não utilizadas na posição atual
		for (const diagnostic of context.diagnostics) {
			debugLog('Processando diagnostic:', diagnostic.code, 'source:', diagnostic.source);
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'unused-variable') {
				debugLog('>>> CRIANDO code actions para unused-variable');
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
				debugLog('>>> Adicionada action: Delete line');

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
				debugLog('>>> Adicionada action: Comment line');
			}

			// Code actions para níveis 88 não utilizados
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'unused-level88') {
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
					const content = getCobolCodeArea(nextLine.text);

					// Ignora comentários
					if (isCobolComment(nextLine.text)) {
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
					const content = getCobolCodeArea(nextLine.text);

					// Ignora comentários
					if (isCobolComment(nextLine.text)) {
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

			// Code actions para operações de cursor em falta
			if (diagnostic.source === 'zCobol Validation' && diagnostic.code === 'missing-cursor-operations') {
				const line = document.lineAt(diagnostic.range.start.line);
				const lineText = line.text;

				// Action 1: Comment line
				const commentLine = new vscode.CodeAction('Comment line (asterisk)', vscode.CodeActionKind.QuickFix);
				commentLine.diagnostics = [diagnostic];
				commentLine.edit = new vscode.WorkspaceEdit();

				let newLineText;
				if (lineText.length >= 7) {
					newLineText = lineText.substring(0, 6) + '*' + lineText.substring(7);
				} else {
					newLineText = lineText.padEnd(6, ' ') + '*';
				}

				commentLine.edit.replace(document.uri, line.range, newLineText);
				codeActions.push(commentLine);
			}
		}

		debugLog('========================================');
		debugLog('Total de code actions criadas:', codeActions.length);
		if (codeActions.length > 0) {
			codeActions.forEach((action, i) => {
				debugLog(`Action ${i}: ${action.title} (kind: ${action.kind})`);
			});
		}
		debugLog('========================================');
		return codeActions;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// --- DefinitionProvider para cursores COBOL ---
	const cursorDefinitionProvider = new CobolCursorDefinitionProvider();
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			[
				{ scheme: 'file', language: 'cobol' },
				{ scheme: 'file', language: 'COBOL' },
				{ scheme: 'file', pattern: '**/*.cbl' },
				{ scheme: 'file', pattern: '**/*.cob' },
				{ scheme: 'file', pattern: '**/*.cobol' },
				{ scheme: 'file', pattern: '**/*.cpy' },
				{ scheme: 'zowe-ds', language: 'cobol' },
				{ scheme: 'zowe-ds', language: 'COBOL' },
				{ scheme: 'zowe-uss', language: 'cobol' },
				{ scheme: 'zowe-uss', language: 'COBOL' },
				{ scheme: 'vscode-remote', language: 'cobol' },
				{ scheme: 'vscode-remote', language: 'COBOL' }
			],
			cursorDefinitionProvider
		)
	);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	debugLog('=== zCobol Validation Extension ATIVADA ===');

	// Cria a coleção de diagnósticos
	diagnosticCollection = vscode.languages.createDiagnosticCollection('zCobol Validation');
	context.subscriptions.push(diagnosticCollection);
	debugLog('DiagnosticCollection criada');

	// Register the code actions provider for COBOL files
	const provider = new CobolCodeActionProvider();
	debugLog('CobolCodeActionProvider instanciado');

	// Document selectors for COBOL files - suporta ficheiros locais e remotos (Zowe Explorer)
	const cobolSelector = [
		// Ficheiros locais
		{ scheme: 'file', language: 'cobol' },
		{ scheme: 'file', language: 'COBOL' },
		{ scheme: 'file', pattern: '**/*.cbl' },
		{ scheme: 'file', pattern: '**/*.cob' },
		{ scheme: 'file', pattern: '**/*.cobol' },
		{ scheme: 'file', pattern: '**/*.cpy' },
		// Ficheiros do Zowe Explorer (datasets e USS)
		{ scheme: 'zowe-ds', language: 'cobol' },
		{ scheme: 'zowe-ds', language: 'COBOL' },
		{ scheme: 'zowe-uss', language: 'cobol' },
		{ scheme: 'zowe-uss', language: 'COBOL' },
		// Outros esquemas remotos
		{ scheme: 'vscode-remote', language: 'cobol' },
		{ scheme: 'vscode-remote', language: 'COBOL' }
	];

	const codeActionsMetadata = {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
	};

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			cobolSelector,
			provider,
			codeActionsMetadata
		)
	);
	debugLog('CodeActionsProvider registrado');

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

	/**
	 * Procura a estrutura de grupo para constantes na WORKING-STORAGE
	 * @param {vscode.TextDocument} document
	 * @param {string} groupName - Nome da estrutura (ex: "CON-CONSTANTS")
	 * @param {boolean} useTraditionalFormat
	 * @returns {{found: boolean, groupLine: number, lastItemLine: number}} - Informação sobre a estrutura
	 */
	function findConstantGroupStructure(document, groupName, useTraditionalFormat) {
		let inWorkingStorage = false;
		let groupLine = -1;
		let lastItemLine = -1;
		let groupLevel = -1;

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i).text;
			const codeArea = getCobolCodeArea(line, useTraditionalFormat);

			// Detecta WORKING-STORAGE SECTION
			if (isWorkingStorageSection(line, useTraditionalFormat)) {
				inWorkingStorage = true;
				continue;
			}

			// Sai da WORKING-STORAGE ao encontrar outra seção
			if (inWorkingStorage && /^\s*(LINKAGE|LOCAL-STORAGE|FILE|SCREEN|PROCEDURE)\s+(SECTION|DIVISION)/i.test(codeArea)) {
				break;
			}

			// Procura a declaração do grupo
			if (inWorkingStorage && groupLine < 0) {
				const groupMatch = codeArea.match(/^\s*(01)\s+([A-Z0-9][\w-]*)\s*\.?\s*$/i);
				if (groupMatch && groupMatch[2].toUpperCase() === groupName.toUpperCase()) {
					groupLine = i;
					groupLevel = parseInt(groupMatch[1]);
					debugLog(`[findConstantGroupStructure] Estrutura de grupo '${groupName}' encontrada na linha ${i}`);
					continue;
				}
			}

			// Se encontrou o grupo, procura o último item dentro dele
			if (groupLine >= 0) {
				const itemMatch = codeArea.match(/^\s*(0[2-9]|[1-4][0-9]|77)\s+([A-Z0-9][\w-]*)/i);
				if (itemMatch) {
					const itemLevel = parseInt(itemMatch[1]);
					// Se o nível é maior que o grupo, é um item dentro do grupo
					if (itemLevel > groupLevel) {
						lastItemLine = i;
						debugLog(`[findConstantGroupStructure] Item encontrado no nível ${itemLevel} na linha ${i}`);
					} else {
						// Se encontrou um nível igual ou menor, saiu do grupo
						debugLog(`[findConstantGroupStructure] Fim do grupo detectado na linha ${i}`);
						break;
					}
				}
			}
		}

		return {
			found: groupLine >= 0,
			groupLine: groupLine,
			lastItemLine: lastItemLine >= 0 ? lastItemLine : groupLine
		};
	}

	// Register the command to create constant
	context.subscriptions.push(
		vscode.commands.registerCommand('zcobol-validation.createConstant', async (document, range, hardcodedValue, valueType) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			// Detecta o formato do ficheiro
			const text = document.getText();
			const useTraditionalFormat = hasSequenceNumbers(text);

			// Check if a constant with the same value already exists
			let existingConstant = null;
			let workingStorageLine = -1;
		let lastCompleteVarLine = -1;
		let inWorkingStorage = false;

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i).text;
			const codeArea = getCobolCodeArea(line, useTraditionalFormat);

			if (isWorkingStorageSection(line, useTraditionalFormat)) {
				workingStorageLine = i;
				inWorkingStorage = true;
				debugLog(`WORKING-STORAGE SECTION encontrada na linha ${i}`);
				continue;
			}

			// Se encontrar outra seção ou PROCEDURE DIVISION, sai da WORKING-STORAGE
			if (inWorkingStorage && /^\s*(LINKAGE|LOCAL-STORAGE|FILE|SCREEN)\s+SECTION/i.test(codeArea)) {
				inWorkingStorage = false;
				debugLog(`Saiu da WORKING-STORAGE na linha ${i} (outra secção encontrada)`);
			}

			// Para quando encontrar PROCEDURE DIVISION
			if (isProcedureDivision(line, useTraditionalFormat)) {
				if (inWorkingStorage) {
					inWorkingStorage = false;
					debugLog(`Saiu da WORKING-STORAGE na linha ${i} (PROCEDURE DIVISION encontrada)`);
				}
				debugLog(`PROCEDURE DIVISION encontrada na linha ${i}, a parar procura`);
				break;
			}

			// Dentro da WORKING-STORAGE, procura linhas que terminam com ponto (fim de definição completa)
			if (inWorkingStorage && /\.\s*$/.test(line)) {
				lastCompleteVarLine = i;
				debugLog(`Última linha completa na WORKING-STORAGE: ${i}`);
			}

			// Verifica se já existe uma constante com o mesmo valor
		// Procura em todos os níveis: 01-49 e 77
		if (inWorkingStorage && /^\s*(01|0[2-9]|[1-4][0-9]|77)\s+/i.test(codeArea)) {
			const valueMatch = codeArea.match(/^\s*(01|0[2-9]|[1-4][0-9]|77)\s+([A-Z0-9][\w-]*)\s+.*VALUE\s+(.+?)\.?\s*$/i);
			if (valueMatch) {
				const constLevel = valueMatch[1];
				const constName = valueMatch[2];
				const constValue = valueMatch[3].trim();

				// Normaliza os valores para comparação (remove aspas externas se existirem)
				let normalizedConstValue = constValue.replace(/^['"]|['"]$/g, '');
				let normalizedHardcodedValue = hardcodedValue.trim().replace(/^['"]|['"]$/g, '');

				debugLog(`[createConstant] Comparando constante nível ${constLevel} '${constName}': '${normalizedConstValue}' com hardcoded: '${normalizedHardcodedValue}'`);

				// Compara os valores normalizados
				if (normalizedConstValue === normalizedHardcodedValue) {
					existingConstant = constName;
					debugLog(`Existing constant found: ${constName} (level ${constLevel}) with value ${constValue}`);
					}
				}
			}
		}

// If found an existing constant, use it automatically
	if (existingConstant) {
		// Replace the hardcoded value with the existing constant
		await editor.edit(editBuilder => {
			editBuilder.replace(range, existingConstant);
		});
		vscode.window.showInformationMessage(
			`Using existing constant '${existingConstant}' with the same value.`
		);
		return;
	}

	// Gera um nome padrão baseado no valor e no prefixo configurado
	const config = vscode.workspace.getConfiguration('zcobol-validation');
	const prefix = config.get('constantPrefix', 'CON-');
	const constantGroupName = String(config.get('constantGroupName', '') || '');

	debugLog(`[createConstant] constantGroupName: '${constantGroupName}'`);

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

	debugLog(`workingStorageLine: ${workingStorageLine}, lastCompleteVarLine: ${lastCompleteVarLine}`);

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
		let insertLine;
		let constantDecl;
		let constantLevel;

		// Verifica se deve usar estrutura de grupo para constantes
		if (constantGroupName && constantGroupName.trim().length > 0) {
			debugLog(`[createConstant] Procurando estrutura de grupo '${constantGroupName}'`);
			const groupInfo = findConstantGroupStructure(document, constantGroupName.trim(), useTraditionalFormat);

			if (groupInfo.found) {
				// Estrutura existe, inserir constante dentro dela como nível 05
				debugLog(`[createConstant] Estrutura encontrada, inserindo após linha ${groupInfo.lastItemLine}`);
				insertLine = groupInfo.lastItemLine + 1;
				constantLevel = '05';
				constantDecl = `           ${constantLevel}  ${constantName.padEnd(28)} ${picClause} VALUE ${valueClause}.\n`;
			} else {
				// Estrutura não existe, criar primeiro
				debugLog(`[createConstant] Estrutura não existe, criando na linha ${lastCompleteVarLine >= 0 ? lastCompleteVarLine + 1 : workingStorageLine + 1}`);
				insertLine = lastCompleteVarLine >= 0 ? lastCompleteVarLine + 1 : workingStorageLine + 1;

				// Cria a estrutura de grupo e a primeira constante dentro dela
				const groupDecl = `       01  ${constantGroupName.trim()}.\n`;
				constantLevel = '05';
				constantDecl = groupDecl + `           ${constantLevel}  ${constantName.padEnd(28)} ${picClause} VALUE ${valueClause}.\n`;
			}
		} else {
			// Comportamento padrão: constante independente no nível 01
			debugLog(`[createConstant] Sem estrutura de grupo, inserindo constante independente`);
			insertLine = lastCompleteVarLine >= 0 ? lastCompleteVarLine + 1 : workingStorageLine + 1;
			constantLevel = '01';
			constantDecl = `       ${constantLevel}  ${constantName.padEnd(28)} ${picClause} VALUE ${valueClause}.\n`;
		}

		debugLog(`[createConstant] Inserindo constante na linha ${insertLine} com nível ${constantLevel}`);
		editBuilder.insert(new vscode.Position(insertLine, 0), constantDecl);

		// Get the full line containing the hardcoded value
		const line = document.lineAt(range.start.line);
		const lineText = line.text;

		// Replace the hardcoded value with the constant name
		const beforeValue = lineText.substring(0, range.start.character);
		const afterValue = lineText.substring(range.end.character);

		// Check if this is a MOVE ... TO statement
		// beforeValue should end with MOVE followed by whitespace: "MOVE "
		// afterValue should start with whitespace followed by TO: " TO "
		const moveMatch = /\bMOVE\s+$/i.test(beforeValue);
		const toMatch = /^\s+TO\s+/i.test(afterValue);

		if (moveMatch && toMatch && useTraditionalFormat) {
			// This is a MOVE TO statement in traditional format
			// Calculate the new line after replacement
			const newLineBeforeTo = beforeValue + constantName;

			// Find where TO keyword starts in the afterValue
			const toKeywordMatch = afterValue.match(/^\s+(TO\s+.*)$/i);
			if (toKeywordMatch) {
				const toAndRest = toKeywordMatch[1];

				// Check if we can keep TO on the same line (within column 72)
				const fullLineLength = newLineBeforeTo.length + 1 + toAndRest.length; // +1 for space before TO

				if (fullLineLength <= 72) {
					// Can keep on same line
					editBuilder.replace(range, constantName);
				} else {
					// Need to move TO to next line
					// Replace the value and everything after it
					const rangeToEndOfLine = new vscode.Range(range.start, line.range.end);

					// Determine indentation for continuation line
					// In COBOL traditional format, continuation starts at column 12 (index 11)
					const continuationIndent = '           '; // 11 spaces (columns 8-11 for continuation)
					const newText = constantName + '\n       ' + continuationIndent + toAndRest;

					editBuilder.replace(rangeToEndOfLine, newText);
				}
			} else {
				// Fallback: just replace the value
				editBuilder.replace(range, constantName);
			}
		} else {
			// Not a MOVE TO or not traditional format, just replace
			editBuilder.replace(range, constantName);
		}
	});
})
	);

	// Validate when document is modified
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			validateCobolDocumentDebounced(event.document);
		})
	);

	// Validate when active editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				validateCobolDocumentDebounced(editor.document);
			}
		})
	);

	// Limpa cache quando documento é fechado
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(document => {
			const uri = document.uri.toString();
			validationCache.delete(uri);
			validationTimers.delete(uri);
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
			    event.affectsConfiguration('zcobol-validation.enableCursorOperationsCheck') ||
			    event.affectsConfiguration('zcobol-validation.operatorFormat')) {
				debugLog('Configuration changed - revalidating all documents');
				// Limpa cache pois configuração mudou
				validationCache.clear();
				vscode.workspace.textDocuments.forEach(document => {
					validateCobolDocument(document);
				});
			}
		})
	);
}

// This method is called when your extension is deactivated
function deactivate() {
	// Limpa timers pendentes
	for (const timer of validationTimers.values()) {
		clearTimeout(timer);
	}
	validationTimers.clear();

	// Limpa cache
	validationCache.clear();

	if (diagnosticCollection) {
		diagnosticCollection.clear();
		diagnosticCollection.dispose();
	}
}

// --- DefinitionProvider para cursores COBOL ---
class CobolCursorDefinitionProvider {
	provideDefinition(document, position) {
		const text = document.getText();
		const useTraditionalFormat = hasSequenceNumbers(text);
		const line = document.lineAt(position.line).text;
		const codeArea = getCobolCodeArea(line, useTraditionalFormat);

		// Regex para OPEN/FETCH/CLOSE <CURSORNAME>
		const opMatch = codeArea.match(/\b(OPEN|FETCH|CLOSE)\b\s+([A-Z0-9][\w-]*)/i);
		if (!opMatch) {
			return null;
		}
		const cursorName = opMatch[2].toUpperCase();
		// Verifica se o cursorName está sob o cursor
		const idx = codeArea.toUpperCase().indexOf(cursorName);
		const colOffset = getColumnOffset(useTraditionalFormat);
		const start = idx + colOffset;
		const end = start + cursorName.length;
		if (!(position.character >= start && position.character <= end)) {
			return null;
		}

		// Procura a declaração do cursor
		const cursors = extractCursorDeclarations(text, useTraditionalFormat);
		const decl = cursors.get(cursorName);
		if (!decl) {
			return null;
		}
		return new vscode.Location(
			document.uri,
			new vscode.Range(decl.line, decl.column, decl.line, decl.column + cursorName.length)
		);
	}
}

module.exports = {
    activate,
    deactivate
}

