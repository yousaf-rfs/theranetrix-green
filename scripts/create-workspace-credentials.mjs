import {randomBytes,scryptSync} from 'node:crypto';
const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');
console.log('Store this workspace password in your password manager:');
console.log(password);
console.log('\nSet these as sensitive Vercel environment variables:');
console.log('AUTH_SECRET='+randomBytes(48).toString('base64url'));
console.log('WORKSPACE_PASSWORD_HASH='+salt+':'+scryptSync(password,salt,64).toString('hex'));
