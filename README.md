# find-select-transform (vscode)

Default keybindings: modifier [alt] + action [x/s/f/g/c/t] (change/select/search/goto/repeat/transform) + target [a/d || x/s/f/g/c/t] (prev/next | cursor).

## Find

The search works by partial matching content of each word (separated by space).

Example document:

```typescript
const foo = 'foo bar';
let greet = 'hello world!';
const name = 'foo';

function greet(name: string) {
	return `Hello, ${name}!`;
}

// this greets the name
console.log(greet(name));

export default {
	foo,
	greet,
};
```

Examples with searchTriggerCount set to 1 (only matches when there is a single result):

- Search: `const f` -> moves cursor to `const f` in `const`.
- Search: `foo` -> cursor to `foo` in `foo bar`.
- Search from line: `alt+f-f 20 g` -> moves cursor to `greets` in `// this greets the name`.

- Find text with `alt+f-a/d` (prev/next). Repeat with `alt+c-c/a/d`.

## Select/Change/Goto

Select, change and move in text. Similar to eg. `ci` in vim.

These commands require typing eg. `{` `(` `[` `'` `"` `\` to the input field, but enter-press is not required.

Examples:

- Select content of next curly: `alt-s-s {`
- Repeat to select content of next curly behind: `alt-c-d` or `alt-c-a`
- Select 2 words starting from 2nd word behind: `alt+s-a 2 2w`

- Select content of next function body: `alt-s-d fn`
- Select content of next function body behind: `alt-s-a fn`

- Select 2nd curly block forward: `alt-s-d 2 {`
- Select 5th line from top: `alt-s-s 5l`
- Select curly in 5th line: `alt-s-s 5 {`
- Select 2 curlies from 5th line: `alt-s-s 5 2{`

- Select content of 4 previous quote pairs: `alt-s-s -4'`
- Select content of 4 quote pairs behind, after 2 pairs: `alt-s-a 2 4'`

- Select body of 2 closest functions forward: `alt-s-d 2fn`
- Select the next 2 function bodies: `alt+c+d`

- Select body of 2 closest functions forward, additive: `alt-s-d +2fn`
- Append next 2 function bodies to selection: `alt+c+d`

- Select body of 2 closest function params behind: `alt-s-a 2fa`

- Change in curly: `alt-x-x {`
- Change next curly: `alt-x-d {`

- Change prev fn body: `alt-x-a fn`
- Change next fn args: `alt-x-d fa`

- Change 10 lines from cursor: `alt-x-x 10L`

- Change content of 2 previous '', additive: `alt-x-a +2'`
- Repeat to select 2 more: `alt-c-c`
- Repeat previous to 2 next '': `alt-c-a`
- Repeat to 4 previous '': `alt-c-d`

- Goto start of curly: `alt-g-g {`
- Goto start of next curly: `alt-g-d {`
- Goto start of prev curly: `alt-g-a {`
- Goto start of curly in line 20: `alt-g-g 20 {`
- Goto second word: `alt-f-d 2 w`

## Transform

Transform text using your own custom ts-functions/regexp-patterns (a transform). These transforms can be associated with the active file type and applied on a file, selection or line basis.

Multiple transforms are applied in order of appearance in the configuration, with the output of the previous transform being the input of the next.

### Transform Selection

- Passed the selected ranges to the transform(s) in `find-select-transform.transform.associations[key]` or `find-select-transform.transform.associations[key].range`.
- Transforms can (optionally) choose the type of input from:
  - raw text block per selection
  - (default) array of lines separated by `\n`, or a custom separator

### Transform Selection With

- Instead of using associated transforms, a quick pick is shown for selecting the transforms to apply.

### Transform Cursor Line

- Passes the line of text under cursor to the transform(s) in `find-select-transform.transform.associations[key]`or `find-select-transform.transform.associations[key].cursor`.

### Transform Cursor Line With

- Instead of using associated transforms, a quick pick is shown for selecting the transforms to apply.

### Transform File

- The entire file is passed to the transform. Associations are shared with Transform Selection.

### Transform File With

- Instead of using associated transforms, a quick pick is shown for selecting the transforms to apply.

### Repeat Transform

- Repeat the last corresponding transforms if a range is selected or cursor is active.
