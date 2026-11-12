import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobImportAccess } from '../job-import.mjs';

test('workspace pairing is explicit and never upgrades an existing job-only grant', () => {
  const access=createJobImportAccess({}),user={id:'alice',username:'alice',active:true,revision:'v1'},config={users:[user]},origin='chrome-extension://'+'a'.repeat(32);
  try{
    const old=access.exchange(access.pair(user).code,origin,config);
    assert.equal(old.scope,'jobs');
    const fresh=access.exchange(access.pair(user,'workspace').code,origin,config);
    assert.equal(fresh.scope,'workspace');
    assert.equal(access.authenticate(old.token,origin,config,false).scope,'jobs');
    assert.equal(access.authenticate(fresh.token,origin,config,false).scope,'workspace');
    assert.equal(access.authenticate(fresh.token,'chrome-extension://'+'b'.repeat(32),config,false),null);
    user.revision='v2';assert.equal(access.authenticate(fresh.token,origin,config,false),null);
  }finally{access.close();}
});
