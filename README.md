# Find Select Transform

Keyboard motions (find, select, change, go to) and your own TypeScript or RegExp transforms for VS Code.

## Quick start

1. Run **Transpile Transforms File** and choose **Create example file**.
2. Put the cursor on a line containing `hello world` and press `alt+t alt+c`. It becomes `foo`.
3. Press it again to revert.

## Motions

Press a key, then type a motion. It applies as soon as it is valid.

| Action | At cursor     | Forward       | Backward      |
| ------ | ------------- | ------------- | ------------- |
| Select | `alt+s alt+s` | `alt+s alt+d` | `alt+s alt+a` |
| Change | `alt+x alt+x` | `alt+x alt+d` | `alt+x alt+a` |
| Find   | `alt+f alt+f` | `alt+f alt+d` | `alt+f alt+a` |
| Repeat | `alt+c alt+c` | `alt+c alt+d` | `alt+c alt+a` |
| Go to  | `alt+g alt+g` or `alt+q` |    |               |

### Syntax

```
[+] [line ] [count] target
```

Example: `alt+s alt+s`, then `5 {` selects the contents of the `{}` on line 5.

- `+` adds to the current selections
- `line ` starts from that line (1-based, note the space)
- `count` repeats; negative goes backward
- With a direction, a number and a space skip ahead instead: `2 {` is the 2nd `{}` ahead

Targets:

- Contents: `(` `[` `{` `'` `"` `` ` `` `//` `/*` `#` `<!--`
- Text: `w` word, `l` line, `L` lines from cursor, `F` file
- Functions: `fn` body, `fa` arguments, `fi` name

### Find

Type words separated by spaces: `con f` matches `const foo`. Start with a line number to search from there: `20 g`.

All settings are prefixed with `find-select-transform.`.

| Setting                      | Default | Effect                                                            |
| ---------------------------- | ------- | ----------------------------------------------------------------- |
| `search.jumpResultThreshold` | `0`     | Jump at this many results or fewer (`0` uses the input threshold) |
| `search.jumpInputThreshold`  | `2`     | Jump once the input is this long                                  |
| `search.jumpSelection`       | `input` | `input`, `first-input`, `first-word`, `words`, `start`, `end`     |

## Transforms

### Transforms file

`transform.src` defaults to `<root>/.vscode/transformer.ts`. It also accepts `<home>`, relative paths and `.js` files.

```ts
export default {
	transforms: {
		// Per line
		trimEnd: (text) => text.trimEnd(),
		// Chained
		quotes: [(t) => t.replaceAll('"', "'"), (t) => t.trim()],
		// Once with the whole range
		sortLines: { type: 'raw', run: (text) => text.split('\n').sort().join('\n') },
		// Split on a custom separator
		upperCsv: { type: 'line', separator: ',', run: (text) => text.trim().toUpperCase() },
		// Using the context
		numberLines: (text, ctx) => `${ctx.line + 1}  ${text}`,
	},
};
```

- Functions may be async and must return a string
- `ctx`: `file`, `ext`, `rootPath`, `raw`, `lines`, `line` (`-1` for raw), `documentText`
- Relative imports work; packages resolve from the workspace's `node_modules`
- Type errors are ignored, only syntax has to be valid
- Set `transform.watch` to re-transpile on save

### RegExp transforms

```jsonc
"find-select-transform.transform.regexp": {
	"toDoubleQuotes": {
		"flags": "g",                          // default "gm"
		"transforms": [["'(.*?)'", "\"$1\""]]  // [matcher, replacer, flags?]
	}
}
```

`additionalValues` adds placeholders: `{ "comment": "(//.*)$" }` makes `$comment` available in replacers.

### Associations

Choose which transforms run per file extension. Several transforms chain, each receiving the previous output.

```jsonc
"find-select-transform.transform.associations": {
	"*": ["trimEnd"],
	"ts": { "cursor": ["numberLines"], "range": ["sortLines", "trimEnd"] }
}
```

A plain array applies to both. *Cursor Line* commands use `cursor`; *Selection* and *Active File* use `range`.

### Commands

| Command                     | Key           |
| --------------------------- | ------------- |
| Transform Selection         | `alt+t alt+s` |
| Transform Selection With    | `alt+t s`     |
| Transform Cursor Line       | `alt+t alt+c` |
| Transform Cursor Line With  | `alt+t c`     |
| Transform Active File       |               |
| Transform Active File With  |               |
| Transform Repeat            | `alt+t alt+t` |
| Undo At Cursor              | `alt+t alt+z` |
| Transpile Transforms File   |               |
| Toggle Keybindings          |               |

*With* commands let you pick from a list. Running *Cursor Line* again reverts it, unless `transform.disableUndoToggle` is set.

Problems are reported in the **find-select-transform** output channel.

## Extension API

```ts
const fst = vscode.extensions.getExtension('0xp.find-select-transform')!.exports;

await fst.transform({ transforms: ['trimEnd'] });
await fst.motion("'", { isNext: true });
```

Also: `transpile`, `getTransforms`, `createExampleTransforms`, `isReady`, `getStatus`, `getCommands`, `getConfig`. See `SelectTransform` in `src/extension.ts`.

## Development

```sh
bun install
bun run build      # or build:watch
bun run typecheck
bun run test:unit
bun run test       # opens a VS Code window
bun run release:build    # checks, then builds the .vsix
bun run release:publish  # to the VS Code Marketplace and Open VSX
```

Press `F5` to launch an Extension Development Host.
