const { app } = require('electron')
app.whenReady().then(() => {
  try {
    const db = require('better-sqlite3')(':memory:')
    db.exec('CREATE TABLE t (a)')
    console.log('SQLITE_OK abi=' + process.versions.modules)
    db.close()
  } catch (e) {
    console.log('SQLITE_FAIL ' + String(e.message).split('\n')[0])
  }
  app.quit()
})
