import {randomInt} from 'node:crypto';
import {once} from 'node:events';
// Some Windows hosts allocate low ephemeral ports, including Fetch-blocked
// ports such as 6000/6667. Pick above the blocked-port range before listening:
// closing and reopening an app server would also close its SQLite store.
export async function listenForTests(server,{choosePort=()=>randomInt(20000,65000)}={}){
    for(let attempt=0;attempt<32;attempt++){
        const port=choosePort();
        if(!Number.isInteger(port)||port<20000||port>=65000)throw Error('Test port must be in the safe high range.');
        try{server.listen(port,'127.0.0.1');await once(server,'listening');return;}
        catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code)||attempt===31)throw error;}
    }
}
