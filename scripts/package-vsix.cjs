const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
execFileSync(process.execPath, [require.resolve('@vscode/vsce/vsce'), 'package', '--out', `gitchat-${version}.vsix`], { stdio: 'inherit' });
