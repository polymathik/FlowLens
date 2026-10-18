const { helper } = require('./d.cjs');
const d = require('./d.cjs');

class C {
  go() {
    helper();
    d.unused();
  }
}

module.exports = { C };
