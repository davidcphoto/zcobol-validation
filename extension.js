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
 * @returns {Map<string, {line: number, column: number}>}
 */
function extractDeclaredVariables(text) {
	const variables = new Map();
	const lines = text.split('\n');

	let inDataDivision = false;
	let inProcedureDivision = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];


		// Detecta início da DATA DIVISION
		if (/^\s*DATA\s+DIVISION/i.test(line)) {
			inDataDivision = true;
			inProcedureDivision = false;
			continue;
		}

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inDataDivision = false;
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
						variables.set(varName, { line: i, column: column });
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
 * @returns {boolean}
 */
function isVariableUsed(text, varName) {
	const lines = text.split('\n');
	let inProcedureDivision = false;
	let procedureDivisionStartLine = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detecta início da PROCEDURE DIVISION
		if (/^\s*PROCEDURE\s+DIVISION/i.test(line)) {
			inProcedureDivision = true;
			procedureDivisionStartLine = i;
			console.log(`PROCEDURE DIVISION encontrada na linha ${i}`);
			continue;
		}

		// Procura uso da variável APENAS no PROCEDURE DIVISION
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
	}

	return false;
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

	// Verifica se a validação está ativada
	const config = vscode.workspace.getConfiguration('zcobol-validation');
	const isEnabled = config.get('enableUnusedVariableCheck', true);

	if (!isEnabled) {
		console.log('Validação de variáveis não utilizadas desativada');
		diagnosticCollection.set(document.uri, []);
		return;
	}

	console.log('Validando ficheiro COBOL:', document.fileName);
	const diagnostics = [];
	const text = document.getText();
	const declaredVariables = extractDeclaredVariables(text);

	console.log('Variáveis declaradas:', Array.from(declaredVariables.keys()));

	// Verifica cada variável declarada
	for (const [varName, position] of declaredVariables) {
		const isUsed = isVariableUsed(text, varName);
		console.log(`Variável ${varName}: ${isUsed ? 'USADA' : 'NÃO USADA'}`);

		if (!isUsed) {
			const line = document.lineAt(position.line);
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

	console.log('Total de warnings criados:', diagnostics.length);
	diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Provedor de code actions para resolver warnings de variáveis não utilizadas
 */
class CobolCodeActionProvider {
	provideCodeActions(document, range, context, token) {
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

	// Valida o documento ativo quando a extensão é ativada
	if (vscode.window.activeTextEditor) {
		validateCobolDocument(vscode.window.activeTextEditor.document);
	}

	// Valida quando o documento é aberto
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(document => {
			validateCobolDocument(document);
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
			if (event.affectsConfiguration('zcobol-validation.enableUnusedVariableCheck')) {
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
