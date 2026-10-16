import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const icons=await readFile(new URL('../icons.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(app.slice(app.indexOf('const baseCategories='),app.indexOf('const mobileLayout=')),context);
vm.runInContext(icons,context);
// Removing the category or tent path must fail, rather than silently using a generic pin.
assert.equal(vm.runInContext("Object.hasOwn(allCategories,'Camping spot')",context),true);
assert.equal(vm.runInContext("categoryPaths['Camping spot'] === tradePaths.Survival",context),true);
assert.notEqual(vm.runInContext("categoryPaths['Camping spot']",context),vm.runInContext("categoryPaths['Mob camp']",context));
// Camping spots, like resource spots, stay in personal notes and are never offered for the public map.
for(const own of ['Camping spot','Herbs','Wood','Ore'])assert.equal(vm.runInContext(`privateOnlyCategories.has(${JSON.stringify(own)}) && privateOnly({category:${JSON.stringify(own)}})`,context),true);
assert.equal(vm.runInContext("privateOnly({category:'Mob camp'})",context),false);
for(const resource of ['Herbs','Wood','Ore'])assert.equal(vm.runInContext(`Object.hasOwn(allCategories,${JSON.stringify(resource)}) && Object.hasOwn(categoryPaths,${JSON.stringify(resource)})`,context),true);
console.log('Camping spot category, tent icon, private-only like resource nodes, distinct mob camp and existing resource nodes passed.');
