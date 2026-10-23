// Built-in SQLite avoids native addon builds on the recipient's machine.
const { DatabaseSync } = require('node:sqlite');
class Database extends DatabaseSync {
  constructor(filename,options={}) {
    if(options.fileMustExist && !require('fs').existsSync(filename)) throw new Error('Database chưa được khởi tạo');
    super(filename);
    this.transactionNumber=0;
  }
  pragma(value) { return this.exec(`PRAGMA ${value}`); }
  transaction(fn) {
    return (...args)=>{
      const name=`office_tx_${++this.transactionNumber}`;
      this.exec(`SAVEPOINT ${name}`);
      try { const result=fn(...args);this.exec(`RELEASE ${name}`);return result; }
      catch(error) { this.exec(`ROLLBACK TO ${name}`);this.exec(`RELEASE ${name}`);throw error; }
    };
  }
}
module.exports=Database;
