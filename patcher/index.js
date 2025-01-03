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
    console.log('File length: ', content.length);

    content = 'console.log("Hello patched");\n' + content;

    content = content.replace(/(var pageLink.+)$/gm, `
        var pageLinkUrl = { id: 'pageLinkUrl', icon: 'link', name: 'Copy URL' };
        var pageLinkUrlMarkdown = { id: 'pageLinkUrlMarkdown', icon: 'link', name: 'Copy URL (Markdown)' };
        $1
    `);

    content = content.replace(/pageLink,/gm, 'pageLink, pageLinkUrl, pageLinkUrlMarkdown, ');

    // util_common.clipboardCopy({ text: `${constant.protocol}://${util_object.universalRoute(object)}` });
    // ^^^^^^^^^^^                          ^^^^^^^^               ^^^^^^^^^^^                ^^^^^^
    // const regex = /([\w_]+)\.clipboardCopy\(\{\s*text:\s*`\${([\w_]+)\.protocol}:\/\/\${([\w_]+)\.universalRoute\(([\w_]+)\)/;
    // const [_, utilCommonVar, constantVar, utilObjectVar, objectVar] = regex.exec(content);

    const linkLine = /^.+var link = `.+$/gm.exec(content)[0];
    const copyLine = /^.+\.copyToast.+commonLink.+link.+$/gm.exec(content)[0];

    content = content.replace(/(case 'pageLink':)/gm, `
        case 'pageLinkUrl': {
            ${linkLine};
            link = '${URL_PREFIX}' + encodeURIComponent(link);
            ${copyLine};
            break;
        }
        case 'pageLinkUrlMarkdown': {
            ${linkLine};
            link = '[' + object.name + ' - Anytype](${URL_PREFIX}' + encodeURIComponent(link) + ')';
            ${copyLine};
            break;
        }
    $1`);

    await fs.writeFile(filePath, content);
    console.log('Wrote to', filePath)
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

    console.log('Extracting...');

    await fs.copyFile(path.join(dir, 'app.asar'), path.join(dir, 'app.asar.bak'));
    await asar.extractAll(path.join(dir, 'app.asar'), path.join(dir, UNPACKED_DIR));
    
    try {
        console.log('Patching...');
        await patchMain(dir);

        console.log('Packing...');
        await asar.createPackageWithOptions(path.join(dir, UNPACKED_DIR), path.join(dir, 'app.asar'), {
            unpack: '**/dist/*.exe'
        });

        await fs.writeFile(path.join(dir, 'patched.txt'), 'ok');

        if (!keepTemp) {
            await fs.rm(path.join(dir, UNPACKED_DIR), { recursive: true, force: true });
        }    

        console.log('Patch done - "npm run unpatch" to revert');
    } catch(e) {
        console.error(e);
        console.log('Error - reverting');
        await unpatch(dir);
    }
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