const fs = require("fs");
const path = require("path");

function kv(f) {
  return `require('../src/${f}')`;
}

module.exports = function() {
  const files = fs
    .readdirSync(path.join(__dirname, "..", "src"))
    .filter(p => /\.ts$/.test(p));
  const code = files.map(kv).join(";\n");
  return {
    code,
    dependencies: files.map(f => require.resolve("../src/" + f)),
    cacheable: true
  };
};
