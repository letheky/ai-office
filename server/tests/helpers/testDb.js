const Database=require('../../src/db/sqlite');
const {__setDbForTests}=require('../../src/db/database');
const openTestDb=()=>new Database(':memory:');
function freshDb({beforeInit}={}) { const db=openTestDb();if(beforeInit)beforeInit(db);return __setDbForTests(db); }
module.exports={freshDb,openTestDb};
