module.exports = function runMigration(migration) {
    const test = migration.createContentType('Test');
    test.createField('title').name('title').type('Symbol').required(false);
  };