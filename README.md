# Find Select Transform

Keyboard driven text motions (find, select, change, go to) plus a way to run your own
TypeScript functions or RegExp rewrites on a selection, the cursor line or the whole file.

- **Find**: incremental word search with jump-to-result decorations.
- **Select / Change / Go to**: `ci{`-style motions for brackets, quotes, comments, words, lines and functions.
- **Transform**: write transforms in `.vscode/transformer.ts` (or configure RegExp pairs in settings) and apply them per file type.

## Getting started

1. Install the extension. The status bar shows `fst: no transforms file`.
2. Click it (or run **find-select-transform: Transpile Transforms File**) and choose **Create example file**.
   An example `.vscode/transformer.ts` is created in your workspace and transpiled.
3. Put the cursor on a line containing `hello world` and press `alt+t alt+c`. It becomes `foo`.
   Press `alt+t alt+c` again to revert, or `alt+t c` to pick any transform.

Nothing besides VS Code is required: the transforms file is compiled with the TypeScript
compiler that ships with VS Code (the workspace's `node_modules/typescript` is used as a fallback).

## Transforms

### The transforms file

`find-select-transform.transform.src` points to a `.ts` (or `.js`) file, by default
`<root>/.vscode/transformer.ts`. `<root>` is the workspace folder, `<home>` your home directory.
The file must default-export an object with a `transforms` record:

```ts
export default {
	transforms: {
		// Line transform (default): called once per line, without the line break.
		trimEnd: (text) => text.trimEnd(),

		// Chained: each function receives the previous result.
		normalizeQuotes: [(t) => t.replaceAll('"', "'"), (t) => t.replaceAll("''", '""')],

		// Raw: called once with the whole selection / line / file.
		sortLines: { type: 'raw', run: (text) => text.split('\n').sort().join('\n') },

		// Custom separator: here each comma separated cell is a "line".
		upperCaseCsv: { type: 'line', separator: ',', run: (text) => text.trim().toUpperCase() },

		// Use the context.
		numberLines: (text, ctx) => `${ctx.line + 1}  ${text}`,
	},
};
```

Each transform is one of:

| Shape                                      | Behaviour                                                      |
| ------------------------------------------ | -------------------------------------------------------------- |
| `fn`                                       | Line transform: `fn(line, ctx)` for every line of each range.  |
| `[fn1, fn2, ...]`                          | Same, chained: `fn2` receives the output of `fn1`.             |
| `{ type: 'raw', run: fn \| fn[] }`         | Runs once per range with the whole text.                       |
| `{ type: 'line', separator?, run }`        | Line transform splitting on `separator` instead of line breaks. |

Functions may be `async` and must return a string. Edits whose output equals the input are skipped.

The second argument `ctx` contains:

| Field          | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `file`         | Absolute path of the document.                                 |
| `ext`          | File extension without the dot.                                |
| `rootPath`     | Workspace folder of the document.                              |
| `raw`          | Full text of the range being transformed.                      |
| `lines`        | All chunks (lines) of the range.                               |
| `line`         | Index of the current chunk in `lines`, `-1` for raw transforms. |
| `documentText` | Full text of the document.                                     |

Relative imports (`./helpers`) are transpiled along with the file. Packages resolve from the
workspace's `node_modules`. Only syntax has to be valid; type errors are ignored, so you can
keep the file loose or type it with the `Transform`/`Ctx` types the example file defines.

The file is transpiled when the extension starts and when you run **Transpile Transforms File**
(or click the status bar item). Set `find-select-transform.transform.watch` to re-transpile on
save. Unchanged files are not re-compiled: the output is cached in the workspace storage.
Problems are reported in the **find-select-transform** output channel.

### RegExp transforms

Simple rewrites can live in settings instead:

```jsonc
"find-select-transform.transform.regexp": {
	"toDoubleQuotes": {
		"flags": "g",                                  // default "gm"
		"transforms": [["'(.*?)'", "\"$1\""]]          // [matcher, replacer, flags?], applied in order
	},
	"formatAssignment": {
		"transforms": [["^(?<type>\\w+)\\s+(?<name>.*?)\\s*=\\s*(?<value>[^;/]*);?.*$", "$comment\nconst $<name> = $<value>;"]],
		"additionalValues": { "comment": "(//.*)$" }   // $comment := what this pattern matches in the input
	}
}
```

Matchers run against the whole range in order. Replacers support the usual `$1`, `$<name>`, `$&`.
`additionalValues` adds `$id` placeholders: each pattern is matched against the original text
(a capture group named like the id wins over the whole match) and every `$id` in the result is
replaced by it, or removed when nothing matched.

### Associations

`find-select-transform.transform.associations` decides which transforms run for which file type:

```jsonc
"find-select-transform.transform.associations": {
	"*": ["trimEnd"],                                   // any extension without its own entry
	"json": ["removeJsonComments"],
	"ts": { "cursor": ["toggleArrowFn"], "range": ["sortImports", "trimEnd"] }
}
```

`cursor` transforms are used by the *Cursor Line* commands, `range` transforms by the *Selection*
and *Active File* commands. A plain array is used for both. Transforms run in the listed order, each
receiving the output of the previous one.

### Commands

| Command                              | Default key    | Description                                                                 |
| ------------------------------------ | -------------- | --------------------------------------------------------------------------- |
| Transform Selection                  | `alt+t alt+s`  | Apply the `range` associations to every selection.                          |
| Transform Selection With             | `alt+t s`      | Pick transforms from a list instead.                                        |
| Transform Cursor Line                | `alt+t alt+c`  | Apply the `cursor` associations to the cursor line. Run again to revert.    |
| Transform Cursor Line With           | `alt+t c`      | Pick transforms from a list instead.                                        |
| Transform Active File                |                | Apply the `range` associations to the whole file.                           |
| Transform Active File With           |                | Pick transforms from a list instead.                                        |
| Transform Repeat                     | `alt+t alt+t`  | Re-run the previous selection or cursor line transforms.                    |
| Undo At Cursor                       | `alt+t alt+z`  | Revert the transform applied to the cursor line.                            |
| Transpile Transforms File            |                | Re-transpile `transform.src`, or create the example file if it is missing.  |
| Toggle Keybindings                   |                | Disable/enable all keybindings of this extension.                           |

The status bar item shows `associated/total` transforms for the current file; hover for details.
Set `find-select-transform.transform.disableUndoToggle` to make *Transform Cursor Line* always transform.

## Motions

Default keybindings: `alt` + action + target, where the action is one of
`x` change, `s` select, `f` find, `g` go to, `c` repeat, and the target is `alt+a` (backward),
`alt+d` (forward) or the action key again (at cursor). Example: `alt+s alt+d` selects forward.

An input box opens for the motion. Element motions apply as soon as they are typed, no enter needed.

### Motion syntax

```
[+] [line ] [count] target
```

| Part     | Meaning                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| `+`      | Add to the current selections instead of replacing them.                                 |
| `line `  | A number followed by a space: operate from that line (1-based).                          |
| `count`  | Repeat count; negative counts go backwards.                                              |
| `target` | `(` `[` `{` `'` `"` `` ` `` `//` `/*` `#` `<!--` element contents, `w` word, `l` line, `L` lines from cursor, `F` file, `fn` function body, `fa` function arguments, `fi` function name |

### Examples

| Keys                 | Effect                                                   |
| -------------------- | -------------------------------------------------------- |
| `alt+s alt+s` `{`    | Select the contents of the enclosing `{}`.               |
| `alt+s alt+d` `2 {`  | Select the contents of the 2nd `{}` ahead.               |
| `alt+s alt+s` `5l`   | Select line 5.                                           |
| `alt+s alt+s` `5 {`  | Select the `{}` contents on line 5.                      |
| `alt+s alt+s` `-4'`  | Select the contents of the 4 previous `''` pairs.        |
| `alt+s alt+a` `2 2w` | Select 2 words starting from the 2nd word behind.        |
| `alt+s alt+d` `+2fn` | Add the next 2 function bodies to the selection.         |
| `alt+x alt+x` `{`    | Change (delete and edit) inside the enclosing `{}`.      |
| `alt+x alt+x` `10L`  | Change the next 10 lines.                                |
| `alt+x alt+d` `fa`   | Change the arguments of the next function.               |
| `alt+g alt+g` `20 {` | Go to the start of the `{}` on line 20.                  |
| `alt+c alt+c`        | Repeat the previous motion. `alt+c alt+a/d` repeats backward/forward. |

### Find

`alt+f alt+f` (from line), `alt+f alt+d` (forward), `alt+f alt+a` (backward). Type words
separated by spaces; each word matches partially and in order, e.g. `con f` matches `const foo`.
Matches are decorated while typing. The cursor jumps to the first match when

- the result count drops to `search.jumpResultThreshold` (when set), or
- the typed input reaches `search.jumpInputThreshold` characters.

`search.jumpSelection` controls what is selected on jump: the whole `input`, the `first-input` word,
the `first-word` or all `words` of the match, or just place the cursor at the `start` or `end`.

With `alt+f alt+f` the input may start with a line number: `20 g` searches for `g` from line 20.

## Settings

| Setting                                        | Default                           | Description                                             |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `transform.src`                                | `<root>/.vscode/transformer.ts`   | Transforms file. `<root>`, `<home>` and relative paths. |
| `transform.watch`                              | `false`                           | Re-transpile when the file changes.                     |
| `transform.associations`                       | `{ "*": ["helloWorldsToFoo"] }`   | Transforms per file extension.                          |
| `transform.regexp`                             | `{}`                              | RegExp transforms.                                      |
| `transform.disableUndoToggle`                  | `false`                           | Never revert on repeated cursor line transform.         |
| `search.jumpResultThreshold`                   | `0`                               | Jump when this many results or fewer remain.            |
| `search.jumpInputThreshold`                    | `2`                               | Jump once the input is this long.                       |
| `search.jumpSelection`                         | `input`                           | What to select on jump.                                 |

All settings are prefixed with `find-select-transform.`.

## Extension API

Other extensions can drive this one through `vscode.extensions.getExtension('0xp.find-select-transform').exports`:

```ts
const fst = vscode.extensions.getExtension('0xp.find-select-transform')!.exports;
await fst.transpile();                                        // (re)compile the transforms file
fst.getTransforms('.ts');                                     // { all, filtered }
await fst.transform({ transforms: ['trimEnd'] });             // on the current selections
await fst.transform({ transforms: [{ type: 'raw', label: 'x', functions: [(t) => t.toUpperCase()] }] });
await fst.motion("'", { isNext: true });                      // select the contents of the next quotes
```

See `SelectTransform` in `src/extension.ts` for the full surface.

## Troubleshooting

- **`fst: no transforms file`**: the configured file does not exist. Click the item to create the example.
- **Transpiling failed**: syntax errors and loader problems are listed in the *find-select-transform* output
  channel (View → Output). Type errors never block transpilation.
- **TypeScript compiler not found**: only happens outside desktop VS Code. Install `typescript` in the workspace.
- **A transform imports a package that cannot be found**: install it in the workspace; the compiled output
  resolves packages from the workspace's `node_modules`.

## Development

```sh
bun install
bun run build          # bundle to ./out (bun run build:watch to keep rebuilding)
bun run typecheck
bun run test:unit      # fast unit tests (bun test)
bun run test           # VS Code integration tests (downloads VS Code on first run)
bun run vscode:package # build the .vsix
```

Press `F5` in VS Code to launch an Extension Development Host with the build task watching `src/`.
