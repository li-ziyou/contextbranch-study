import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const python = process.env.STUDY_TEST_PYTHON || path.resolve('.study-runtime', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
execFileSync(python, ['-c', `import sys,zipfile,json,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 forbidden=['/reference/','/private-grader/','/private_tests/','/participant-bundles/','/contextbranch-study/','/node_modules/','/.git/','/runs/']
 assert not any(any(part in name for part in forbidden) for name in names),names
 allowed=('extension/study-assets/','extension/webview/','extension/media/','extension/dist/')
 assert all(name.startswith(allowed) or name in ['extension/package.json','extension/README.md','extension.vsixmanifest','[Content_Types].xml'] for name in names),names
 index=json.loads(z.read('extension/study-assets/index.json'))
 for name,sha in index['files'].items(): assert hashlib.sha256(z.read('extension/study-assets/'+name)).hexdigest()==sha,name
 assert 'assert len(message_failures) >= 1' in z.read('extension/study-assets/tasks/exception-group-matcher/tests/test_integration.py').decode()
 print('VSIX verified: public-only tasks, intact file hashes, merged assertion, no source checkout or research data.')`, `contextbranch-${version}.vsix`], { stdio: 'inherit' });
