// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

function assert(condition: boolean, message?: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

// Track state per document
class DocumentState {
	private document: vscode.TextDocument;
	private fullRange: vscode.Range | undefined;
	currentRange: vscode.Range | undefined;
	weAreChanging: boolean = false;
	steppingInProgress: boolean = false;
	currentToken: number | undefined = undefined;
	remainingText: string | undefined = undefined;
	private tokens: string[] = [];
	private tokensUpToDate: boolean = false;
	constructor(document: vscode.TextDocument) {
		this.document = document;
	}
	setFullRange(range: vscode.Range | undefined): void {
		this.fullRange = range;
		this.tokens = [];
		this.tokensUpToDate = false;
		this.remainingText = undefined;
		this.currentToken = undefined;
		this.steppingInProgress = false;
	}
	getFullRange(): vscode.Range | undefined {
		return this.fullRange;
	}
	getTokens(): string[] {
		if (!this.tokensUpToDate) {
			this.makeTokens();
		}
		return this.tokens;
	}
	private makeTokens(): void {
		const text = this.document.getText(this.fullRange);
		// this.tokens should be empty, because this is only called when
		// tokensUpToDate is false, and tokens are always cleared when
		// that's set to false
		assert(this.tokens.length === 0);
		let tokens = text.split(/\b/);
		// Windows uses \r\n, which means we can just treat \r as a regular
		// character, and it will come out fine.
		// Split up tokens with newlines in them
		tokens = tokens.flatMap((token) => {
			// Split on newlines, but keep the newlines in the tokens
			// This regex matches in between a newline and the next character
			return token.split(/(?<=\n)/);
		});
		// Merge tokens with newlines in them with previous token,
		// if the previous doesn't yet have one.
		for (let i = 1; i < tokens.length; i++) {
			if (tokens[i].endsWith('\n') && !tokens[i - 1].endsWith('\n')) {
				tokens[i - 1] += tokens[i];
				tokens[i] = '';
			}
		}
		// Merge whitespace-only tokens with the next token as long
		// as they don't have a newline in them
		for (let i = 0; i < tokens.length - 1; i++) {
			if (tokens[i].match(/^\s*$/) && !tokens[i].endsWith('\n')) {
				tokens[i + 1] = tokens[i] + tokens[i + 1];
				tokens[i] = '';
			}
		}
		// Remove empty tokens
		this.tokens = tokens.filter((token) => token.length > 0);
		this.tokensUpToDate = true;
	}
}

// Make our own map that returns a new value if the key is not found
class StateMap {
	private map: Map<string, DocumentState> = new Map();
	getState(document: vscode.TextDocument): DocumentState {
		const key = document.uri.toString();
		const value = this.map.get(key);
		if (!value) {
			let value = new DocumentState(document);
			this.map.set(key, value);
			return value;
		} else {
			return value;
		}
	}
	rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
		const oldKey = oldUri.toString();
		const newKey = newUri.toString();
		const value = this.map.get(oldKey);
		if (value) {
			this.map.delete(oldKey);
			this.map.set(newKey, value);
		}
	}
	delete(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		this.map.delete(key);
	}
	clear(): void {
		this.map.clear();
	}
}

// Setup a map to track the state of each document
let documentStateMap = new StateMap();

enum StepType {
	nextWord,
	previousWord,
	nextLine,
	previousLine,
}

function positionPlusOffset(document: vscode.TextDocument, position: vscode.Position, offset: number): vscode.Position {
	const returnValue = document.positionAt(document.offsetAt(position) + offset);
	// This doesn't catch all mistakes, but if the offset takes us past the end
	// of the document, it will be caught here.
	assert(document.offsetAt(returnValue) === document.offsetAt(position) + offset);
	return returnValue;
}

async function doStep(stepType: StepType): Promise<void> {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	// Check if the editor has anything selected
	let selections = editor.selections;
	if (selections.length > 1) {
		vscode.window.showErrorMessage('Please have only a single selection');
		return;
	}
	let document = editor.document;
	let state = documentStateMap.getState(document);
	// There's always at least one selection, because if it's empty it tells us
	// where the cursor is. So only if it's not empty do we have a selection.
	// If we have a selection we ignore any last change, and start a new stepping
	// session.
	if (!selections[0].isEmpty) {
		state.setFullRange(new vscode.Range(selections[0].start, selections[0].end));
	}
	// Initial step is different for each type:
	// Next: Remove everything except the first token/line
	// Previous: Remove the last token/line
	if (!state.steppingInProgress) {
		const currentRange = state.getFullRange();
		if (!currentRange) {
			vscode.window.showErrorMessage('Please select or insert something to step through');
			return;
		}
		const tokens = state.getTokens();
		state.steppingInProgress = true;
		switch (stepType) {
			case StepType.nextWord:
				state.currentToken = 0;
				break;
			case StepType.previousWord:
				state.currentToken = tokens.length - 2;
				break;
			case StepType.nextLine:
				// find first token ending with \n
				for (let i = 0; i < tokens.length; i++) {
					if (tokens[i].endsWith('\n')) {
						state.currentToken = i;
						break;
					}
				}
				break;
			case StepType.previousLine:
				// find last token ending with \n, except for the very last
				// token, because if that ends with \n, we want the second to
				// last token ending with \n.
				for (let i = tokens.length - 2; i >= 0; i--) {
					if (tokens[i].endsWith('\n')) {
						state.currentToken = i;
						break;
					}
				}
				break;
		}
		// Because TypeScript doesn't know about exhaustive matches
		assert(state.currentToken !== undefined, 'Invalid step type');
		// Get total length of tokens up to and including currentToken
		let totalLength = 0;
		for (let i = 0; i <= state.currentToken; i++) {
			totalLength += tokens[i].length;
		}
		const deleteStart = positionPlusOffset(document, currentRange.start, totalLength);
		const deleteRange = new vscode.Range(deleteStart, currentRange.end);
		state.remainingText = document.getText(deleteRange);
		// Since we're deleting, we can update currentRange before the edit
		state.currentRange = new vscode.Range(currentRange.start, deleteStart);
		state.weAreChanging = true;
		return editor.edit((editBuilder) => {
			editBuilder.delete(deleteRange);
		}).then(() => {
			state.weAreChanging = false;
		});
	}
	// We are already stepping, so we need to add/remove the next token/line
	const tokens = state.getTokens();
	assert(state.currentToken !== undefined, 'Invalid state: currentToken is undefined');
	assert(state.remainingText !== undefined, 'Invalid state: remainingText is undefined');
	assert(state.currentRange !== undefined, 'Invalid state: currentRange is undefined');
	switch (stepType) {
		case StepType.nextWord:
		case StepType.nextLine:
			if (state.currentToken >= tokens.length - 1) {
				state.currentToken = tokens.length - 1;
				return;
			}
			const nextWord = state.currentToken + 1;
			if (stepType === StepType.nextWord) {
				state.currentToken = nextWord;
			} else {
				// find next token ending with \n
				for (let i = nextWord; i < tokens.length; i++) {
					if (tokens[i].endsWith('\n')) {
						state.currentToken = i;
						break;
					}
					if (i === tokens.length - 1) {
						state.currentToken = i;
					}
				}
			}
			let newText = tokens.slice(nextWord, state.currentToken + 1).join('');
			state.remainingText = state.remainingText.substring(newText.length);
			const insertAt = state.currentRange.end;
			const currentStart = state.currentRange.start;
			state.weAreChanging = true;
			return editor.edit((editBuilder) => {
				editBuilder.insert(insertAt, newText);
			}).then((succeeded) => {
				assert(succeeded, 'Edit failed');
				state.weAreChanging = false;
				// Since we're inserting, we _must_ update currentRange after the edit
				// because the range would otherwise cover text that would be changed
				// by the edit, causing the offset translation to be wrong.
				const newEnd = positionPlusOffset(document, insertAt, newText.length);
				state.currentRange = new vscode.Range(currentStart, newEnd);
			});
		case StepType.previousWord:
		case StepType.previousLine:
			if (state.currentToken <= -1) {
				state.currentToken = -1;
				return;
			}
			const previousWord = state.currentToken;
			if (stepType === StepType.previousWord) {
				state.currentToken = state.currentToken - 1;
			} else {
				// find previous token ending with \n
				for (let i = state.currentToken - 1; i >= 0; i--) {
					if (tokens[i].endsWith('\n')) {
						state.currentToken = i;
						break;
					}
					if (i === 0) {
						state.currentToken = -1;
					}
				}
			}
			// currentToken is the last visible, so we delete from the next one
			// (first +1). We delete up to and including the previous one.
			// second +1 is for because slice is exclusive of the end index.
			const deleteTokens = tokens.slice(state.currentToken + 1, previousWord + 1);
			const deleteText = deleteTokens.join('');
			const deleteLength = deleteText.length;
			const deleteStart = positionPlusOffset(document, state.currentRange.end, -deleteLength);
			const deleteRange = new vscode.Range(deleteStart, state.currentRange.end);
			state.remainingText = deleteText + state.remainingText;
			// Since we're deleting, we can update currentRange before the edit
			state.currentRange = new vscode.Range(state.currentRange.start, deleteStart);
			state.weAreChanging = true;
			return editor.edit((editBuilder) => {
				editBuilder.delete(deleteRange);
			}).then((succeeded) => {
				assert(succeeded, 'Edit failed');
				state.weAreChanging = false;
			});
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('change-stepper.debug', () => {
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		let document = editor.document;
		let state = documentStateMap.getState(document);
		let stateCopy = JSON.parse(JSON.stringify(state));
		stateCopy.document = stateCopy.document.uri.toString();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('change-stepper.nextWord', async () => {
		return doStep(StepType.nextWord);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('change-stepper.previousWord', async () => {
		return doStep(StepType.previousWord);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('change-stepper.nextLine', async () => {
		return doStep(StepType.nextLine);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('change-stepper.previousLine', async () => {
		return doStep(StepType.previousLine);
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
		// Add the last change to the map
		let state = documentStateMap.getState(event.document);
		// Only track changes that are not caused by us
		if (state.weAreChanging) {
			return;
		}
		// Changes with multiple cursors are a bit complex, so don't store those.
		// Changes that have no text are deletes, which we can't do anything with either.
		// Also ignore changes that are only one character long, because those are pretty
		// useless to step through.
		// Maybe at some point we want to allow single character changes, when stepping has
		// started, so users can type between steps. But that can get complicated, so not
		// doing that for now.
		if (event.contentChanges.length !== 1
			|| event.contentChanges[0].text.length === 0
			|| event.contentChanges[0].text.length === 1) {
			// Set lastChange to undefined because we don't want to do anything with
			// older changes. Setting to undefined gets rid of older changes.
			state.setFullRange(undefined);
			return;
		}
		const change = event.contentChanges[0];
		const start = change.range.start;
		const newLength = change.text.length;
		const newEndOffset = change.rangeOffset + newLength;
		const newEnd = event.document.positionAt(newEndOffset);
		state.setFullRange(new vscode.Range(start, newEnd));
	}));

	// Track when documents are closed so we can remove them from the map
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
		documentStateMap.delete(document);
	}));

	// Track renames of files so we can update the map
	context.subscriptions.push(vscode.workspace.onDidRenameFiles((event) => {
		event.files.forEach((file) => {
			documentStateMap.rename(file.oldUri, file.newUri);
		});
	}));
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Drop the map's contents
	documentStateMap.clear();
}
