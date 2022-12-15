module.exports = function runMigration(migration) {
    const test = migration.createContentType('Test').name('Test Content Model').description("Test model");
    test.createField('title').name('title').type('Symbol').required(false);
  };