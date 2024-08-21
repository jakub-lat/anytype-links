const fs = require('fs').promises;
const util = require('util');
const asar = require('@electron/asar');
const childProcess = require('child_process');
const path = require('path');
const exec = util.promisify(childProcess.exec);
const { program } = require('commander');

const UNPACKED_DIR = 'temp';
const URL_PREFIX = 'https://anytype-links.vercel.app?url=';

const isPatched = (dir) => fs.stat(path.join(dir, 'patched.txt')).then(() => true).catch(() => false);

async function killProcess(name) {
    try {
        switch (process.platform) {
            case 'win32':
                const r = await exec('taskkill /F /IM ' + name + '.exe /T');
                break;
            default:
                await exec('pkill -f ' + name);
                break;
        }
    } catch (e) {
    }
}

async function unpatch(dir) {
    console.log('Unpatching...');

    await fs.rm(path.join(dir, UNPACKED_DIR), { recursive: true, force: true });
    await fs.rm(path.join(dir, 'app.asar'));
    await fs.copyFile(path.join(dir, 'app.asar.bak'), path.join(dir, 'app.asar'));
}

async function patchMain(dir) {
    const filePath = path.join(dir, UNPACKED_DIR, 'dist/js/main.js');
    let content = await fs.readFile(filePath, 'utf8');

    content = 'console.log("Hello patched");\n' + content;

    content = content.replace(/(let pageLink.+)$/gm, `$1
        let pageLinkUrl = { id: 'pageLinkUrl', icon: 'link', name: 'Copy URL' };
        let pageLinkUrlMarkdown = { id: 'pageLinkUrlMarkdown', icon: 'link', name: 'Copy URL (Markdown)' };
    `);

    content = content.replace(/pageLink,/gm, 'pageLink, pageLinkUrl, pageLinkUrlMarkdown, ');

    // util_common.clipboardCopy({ text: `${constant.protocol}://${util_object.universalRoute(object)}` });
    // ^^^^^^^^^^^                          ^^^^^^^^               ^^^^^^^^^^^                ^^^^^^
    const regex = /([\w_]+)\.clipboardCopy\(\{\s*text:\s*`\${([\w_]+)\.protocol}:\/\/\${([\w_]+)\.universalRoute\(([\w_]+)\)/;
    const [_, utilCommonVar, constantVar, utilObjectVar, objectVar] = regex.exec(content);

    content = content.replace(/(case 'pageLink':)/gm, `
        case 'pageLinkUrl': {
            const anytypeUrl = ${constantVar}.protocol + '://' + ${utilObjectVar}.universalRoute(${objectVar});
            ${utilCommonVar}.clipboardCopy({ text: '${URL_PREFIX}' + encodeURIComponent(anytypeUrl) });
            break;
        }
        case 'pageLinkUrlMarkdown': {
            const anytypeUrl = ${constantVar}.protocol + '://' + ${utilObjectVar}.universalRoute(${objectVar});
            ${utilCommonVar}.clipboardCopy({ text: '[' + ${objectVar}.name + ' - Anytype](${URL_PREFIX}' + encodeURIComponent(anytypeUrl) + ')' });
            break;
        }
    $1`);

    await fs.writeFile(filePath, content);
}

async function patch(dir, keepTemp) {
    console.log(`Using directory ${path.resolve(dir, '..')}`);

    console.log('Killing Anytype process...')
    await killProcess('anytype');
    await killProcess('anytypeHelper');

    if (await isPatched(dir)) {
        console.log('Already patched, unpatching first...');
        await unpatch(dir);
    }

    console.log('Patching...');

    await fs.copyFile(path.join(dir, 'app.asar'), path.join(dir, 'app.asar.bak'));
    await asar.extractAll(path.join(dir, 'app.asar'), path.join(dir, UNPACKED_DIR));

    await patchMain(dir);

    await asar.createPackageWithOptions(path.join(dir, UNPACKED_DIR), path.join(dir, 'app.asar'), {
        unpack: '**/dist/anytypeHelper.exe'
    });

    await fs.writeFile(path.join(dir, 'patched.txt'), 'ok');

    if (!keepTemp) {
        await fs.rm(path.join(dir, UNPACKED_DIR), { recursive: true, force: true });
    }

    console.log('Patch done - "npm run unpatch" to revert');
}

const defaultDir = () => process.env.USERPROFILE + '\\AppData\\Local\\Programs\\anytype';

function resolveDir(dir) {
    dir ||= defaultDir();
    dir = path.join(dir, 'resources');

    fs.access(dir).catch(() => {
        throw new Error(`Directory ${dir} does not exist! Use --dir to specify the correct Anytype directory.`);
    });

    return dir;
}

program
    .command('patch [dir]')
    .option('--keep-temp')
    .action((dir, options) => {
        patch(resolveDir(dir), options.keepTemp);
    });

program
    .command('unpatch [dir]')
    .action((dir) => {
        unpatch(resolveDir(dir));
    });

program.parse();