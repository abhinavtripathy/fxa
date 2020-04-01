const fs = require("fs");
const { firefox } = require("playwright");
const { createFsFromVolume, Volume } = require("memfs");
const webpack = require("webpack");
const path = require("path");

const compiler = webpack({
  entry: require.resolve("./lib/entry.js"),
  output: {
    filename: "tests.js",
    path: "/"
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"]
  },
  module: {
    rules: [
      { test: /\.tsx?$/, loader: "ts-loader" },
      {
        test: require.resolve("./lib/entry.js"),
        use: ["val-loader"]
      }
    ]
  }
});
const mfs = createFsFromVolume(new Volume());
mfs.join = path.join.bind(path);
compiler.outputFileSystem = mfs;

async function runTests() {
  const mocha = await fs.promises.readFile(require.resolve("mocha/mocha.js"), {
    encoding: "utf8"
  });
  const tests = await mfs.promises.readFile("/tests.js", { encoding: "utf8" });
  const browser = await firefox.launch(); // { headless: false, slowMo: 50 }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", msg => {
    console.error(msg.text());
  });
  await page.evaluate(mocha);
  await page.evaluate(
    `mocha.setup({
      ui: 'bdd',
      reporter: 'json',
      timeout: 5000
    })`
  );
  await page.evaluate(tests);
  await page.evaluate(`window.runner = mocha.run()`);
  await page.waitForFunction(`typeof runner.testResults !== 'undefined'`, {
    polling: 1000,
    timeout: 15000
  });
  await browser.close();
}

compiler.run((err, stats) => {
  if (err) {
    return console.error(err);
  }
  if (stats.compilation.errors.length > 0) {
    return stats.compilation.errors.forEach(e => console.error(e));
  }
  runTests();
});
