import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

async function setText(editor: vscode.TextEditor, text: string) {
	// get full range of document
	const fullRange = new vscode.Range(
		editor.document.positionAt(0),
		editor.document.positionAt(editor.document.getText().length)
	);
	return editor.edit((editBuilder) => {
		editBuilder.replace(fullRange, text);
	})
		.then((succeeded) => assert(succeeded, 'edit failed'))
		.then(() => {
			assert.strictEqual(editor.document.getText(), text);
		});
}

// Type a string one character at a time
async function typeString(editor: vscode.TextEditor, text: string) {
	for (let i = 0; i < text.length; i++) {
		const position = editor.selection.active;
		await editor.edit(editBuilder => {
			editBuilder.insert(position, text[i]);
		})
			.then((succeeded) => assert(succeeded, 'edit failed'));
	}
}

// Insert a string in a single edit
async function insertString(editor: vscode.TextEditor, text: string, position: vscode.Position) {
	return editor.edit(editBuilder => {
		editBuilder.insert(position, text);
	})
		.then((succeeded) => {
			assert(succeeded, 'edit failed');
			const positionAfter = editor.document.positionAt(editor.document.offsetAt(position) + text.length);
			// Put cursor after the inserted text
			editor.selection = new vscode.Selection(positionAfter, positionAfter);
		});
}

type Command = {
	kind: 'Command';
	readonly command: string;
	readonly expectedResult: string;
};

type Typing = {
	kind: 'Typing';
	readonly text: string;
	readonly expectedResult: string;
};

type Insertion = {
	kind: 'Insertion';
	readonly text: string;
	readonly position: vscode.Position;
	readonly expectedResult: string;
};

type SetText = {
	kind: 'SetText';
	readonly text: string;
};

type Action = Command | Typing | Insertion | SetText;

async function actionsRunnerWithContext(id: string, editor: vscode.TextEditor, actions: Action[], before: string, after: string) {
	for (let index in actions) {
		const action = actions[index];
		let errorMessage = '';
		switch (action.kind) {
			case 'Command':
				await vscode.commands.executeCommand(action.command);
				errorMessage = `Action "${id}":${index} failed: command="${action.command}"`;
				break;
			case "Typing":
				await typeString(editor, action.text);
				errorMessage = `Action "${id}":${index} failed: typing="${action.text}"`;
				break;
			case "Insertion":
				await insertString(editor, action.text, action.position);
				errorMessage = `Action "${id}":${index} failed: insertion="${action.text}" at position=${action.position}`;
				break;
			case "SetText":
				await setText(editor, before + after);
				const beforePlusAfter = before + after;
				const beforeLength = before.length;
				const position = editor.document.positionAt(before.length);
				await insertString(editor, action.text, editor.document.positionAt(before.length));
				errorMessage = `Action "${id}":${index} failed: setText="${action.text}" at position=${JSON.stringify(position)} before="${before}" after="${after}" beforePlusAfter="${beforePlusAfter}" beforeLength=${beforeLength}`;
				break;
		}
		let expected = '';
		if (action.kind !== 'SetText') {
			expected = before + action.expectedResult + after;
		} else {
			expected = before + action.text + after;
		}
		assert.strictEqual(editor.document.getText(), expected, errorMessage + `\nExpected: "${expected}"\nActual: "${editor.document.getText()}"`);
	}
}

async function actionsRunner(id: string, editor: vscode.TextEditor, commands: Action[]) {
	await actionsRunnerWithContext(id, editor, commands, '', '');
}

async function setLineEnding(editor: vscode.TextEditor, lineEnding: string) {
	return editor.edit(editBuilder => {
		if (lineEnding === 'CRLF') {
			editBuilder.setEndOfLine(vscode.EndOfLine.CRLF);
		} else if (lineEnding === 'LF') {
			editBuilder.setEndOfLine(vscode.EndOfLine.LF);
		} else {
			throw new Error(`Unknown line ending: ${lineEnding}`);
		}
	})
		.then((succeeded) => assert(succeeded, 'edit failed'));
}

suite('the whole extension', () => {
	test('single line', async () => {
		let document = await vscode.workspace.openTextDocument(vscode.Uri.file('singleline.txt').with({ scheme: 'untitled' }));
		let editor = await vscode.window.showTextDocument(document);
		assert(editor !== undefined);
		// Test single line, no newline at the end
		const commands: Action[] = [
			{ kind: 'SetText', text: 'Hello World, this is a test' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: '' },
			// Should not be able to go past the start
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: '' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: '' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, ' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, this' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, this is' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, this is a' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, this is a test' },
			// Should not be able to go past the end
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, this is a test' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, this is a test' },
			// From anywhere, previous line should go to the start
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'Hello World, this is a' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'Hello World, this is' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'Hello World, this' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: '' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: '' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'Hello World, this is a test' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: '' },
			// From anywhere, next line should go to the end
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'Hello World, this is a test' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'Hello World, this is a test' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: '' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'Hello World, this is a test' },
			// Typing anything should stop the stepping session
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'Hello World, this is a' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'Hello World, this is' },
			{ kind: 'Typing', text: ' my test', expectedResult: 'Hello World, this is my test' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'Hello World, this is my test' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'Hello World, this is my test' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: 'Hello World, this is my test' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'Hello World, this is my test' },
		];
		await actionsRunner('nothing around', editor, commands);
		await actionsRunnerWithContext('stuff before and after', editor, commands, 'randomwhatever', 'morestuff');
		await setLineEnding(editor, 'CRLF');
		await actionsRunnerWithContext('context with CRLF', editor, commands, 'randomwhatever\r\n', 'morestuff\r\n');
	});

	test('multi line', async () => {
		let document = await vscode.workspace.openTextDocument(vscode.Uri.file('multiline.txt').with({ scheme: 'untitled' }));
		let editor = await vscode.window.showTextDocument(document);
		assert(editor !== undefined);
		// Test multi line, no newline at the end
		const actions: Action[] = [
			{ kind: 'SetText', text: 'now doing\na multiline test\nwith\nvarying number of words' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\n' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\n' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\n' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying number' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying number of' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying number of words' },
			// Should not be able to go past the end
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying number of words' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying number of words' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\na multiline test\nwith\nvarying number of' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\na multiline test\nwith\nvarying number' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\na multiline test\nwith\nvarying' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\na multiline test\nwith\n' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\na multiline test\n' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\na multiline' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\na' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now doing\n' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: 'now' },
			// Should not be able to go past the start
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: '' },
			{ kind: 'Command', command: 'change-stepper.previousWord', expectedResult: '' },
			// From anywhere, previous line should go to the start of the line
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'now doing\n' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'now doing\na multiline test\n' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'now doing\na multiline test\nwith\n' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: 'now doing\na multiline test\nwith\n' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: 'now doing\na multiline test\n' },
			{ kind: 'Command', command: 'change-stepper.previousLine', expectedResult: 'now doing\n' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'now doing\na multiline test\n' },
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'now doing\na multiline test\nwith\n' },
			{ kind: 'Command', command: 'change-stepper.nextWord', expectedResult: 'now doing\na multiline test\nwith\nvarying' },
			// From anywhere, next line should go to the end of the line
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'now doing\na multiline test\nwith\nvarying number of words' },
			// Should not be able to go past the end
			{ kind: 'Command', command: 'change-stepper.nextLine', expectedResult: 'now doing\na multiline test\nwith\nvarying number of words' },
		];
		let currentFullText = '';
		let actionsEolAtEnd: Action[] = actions.map(a => {
			if (a.kind === 'SetText') {
				currentFullText = a.text;
				return { kind: 'SetText', text: a.text + '\n' };
			}
			if (a.expectedResult === currentFullText) {
				return { kind: 'SetText', text: a.expectedResult + '\n' };
			}
			return a;
		});
		let actionsCRLF: Action[] = actions.map(a => {
			if (a.kind === 'SetText') {
				return { kind: 'SetText', text: a.text.replace(/\n/g, '\r\n') };
			}
			return { ...a, expectedResult: a.expectedResult.replace(/\n/g, '\r\n') };
		});
		let actionsEolAtEndCRLF: Action[] = actionsEolAtEnd.map(a => {
			if (a.kind === 'SetText') {
				return { kind: 'SetText', text: a.text.replace(/\n/g, '\r\n') };
			}
			return { ...a, expectedResult: a.expectedResult.replace(/\n/g, '\r\n') };
		});

		await setLineEnding(editor, 'LF');
		await actionsRunner('empty', editor, actions);
		await actionsRunnerWithContext('stuff before and after', editor, actions, 'randomwhatever', 'morestuff');
		await actionsRunnerWithContext('stuff before and after with newlines', editor, actions, 'randomwhatever\n', 'morestuff\n');
		await actionsRunner('empty with EOL at end of change', editor, actionsEolAtEnd);
		await actionsRunnerWithContext('stuff before and after with EOL at end of change', editor, actionsEolAtEnd, 'randomwhatever', 'morestuff');
		await actionsRunnerWithContext('stuff before and after with EOLs and EOL at end of change', editor, actionsEolAtEnd, 'randomwhatever\n', 'morestuff\n');
		await setLineEnding(editor, 'CRLF');
		await actionsRunner('empty with CRLF', editor, actionsCRLF);
		await actionsRunnerWithContext('stuff before and after CRLF', editor, actionsCRLF, 'randomwhatever', 'morestuff');
		await actionsRunnerWithContext('stuff before and after with newlines CRLF', editor, actionsCRLF, 'randomwhatever\r\n', 'morestuff\r\n');
		await actionsRunner('empty with EOL at end of change and CRLF', editor, actionsEolAtEndCRLF);
		await actionsRunnerWithContext('stuff before and after with EOL at end of change and CRLF', editor, actionsEolAtEndCRLF, 'randomwhatever', 'morestuff');
		await actionsRunnerWithContext('stuff before and after with EOLs and EOL at end of change and CRLF', editor, actionsEolAtEndCRLF, 'randomwhatever\r\n', 'morestuff\r\n');
	});
});
