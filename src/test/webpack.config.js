const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..', '..');

function makeExport(
  sourceFilepath /* string */,
  outFolder /* string */,
  mode /* string */,
  library /* optional string */,
  externals /* object */
) /* void */ {
  const name = library ? library.toLowerCase() : '[name]';
  const filename = `${name}${mode === 'production' ? '.min' : ''}.js`;

  return {
    devtool: 'source-map',
    mode,
    entry: sourceFilepath,
    output: {
      path: outFolder,
      filename,
      library,
    },
    target: ['web', 'es5'],
    resolve: {
      extensions: ['.ts'],
      alias: {
        three: path.resolve('./node_modules/three'),
      },
    },
    module: {
      rules: [
        {
          test: /\.ts?$/,
          // exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                //   transpileOnly: true,
                compilerOptions: {
                  rootDir: path.join(PROJECT_DIR, 'src'),
                },
                configFile: path.join(PROJECT_DIR, 'src', 'test', 'tsconfig.json'),
              },
            },
          ],
        },
      ],
    },
    externals,
  };
}

const srcDir = path.join(PROJECT_DIR, 'src', 'test');
const targetDir = path.join(PROJECT_DIR, 'test', 'script');

module.exports = [
  makeExport(path.join(srcDir, 'main.ts'), targetDir, 'development', undefined, {
    'three-usage-test': 'THREE',
    three: 'THREE',
  }),
  makeExport(path.join(srcDir, 'libs', 'three-usage-test.ts'), targetDir, 'development', 'THREE'),
];
