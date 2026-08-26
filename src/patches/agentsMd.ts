// Please see the note about writing patches in ./index

import { showDiff } from './index';

/**
 * Patches the CLAUDE.md file reading function to also check for alternative
 * filenames (e.g., AGENTS.md) when CLAUDE.md doesn't exist.
 *
 * Supports two code patterns across CC versions:
 *
 * CC <=2.1.69 (sync): Function uses readFileSync/existsSync/statSync directly
 * CC >=2.1.83 (async): File reading is split into jh1 (async reader) and XB9 (processor)
 *   The async reader catches ENOENT/EISDIR errors and returns {info:null,includePaths:[]}
 */
export const writeAgentsMd = (
  file: string,
  altNames: string[]
): string | null => {
  const wrapper2233 = writeAgentsMdWrapper2233(file, altNames);
  if (wrapper2233) return wrapper2233;

  const async2214 = writeAgentsMdAsync2214(file, altNames);
  if (async2214) return async2214;

  const async2199 = writeAgentsMdAsync2199(file, altNames);
  if (async2199) return async2199;

  const asyncResult = writeAgentsMdAsync(file, altNames);
  if (asyncResult) return asyncResult;

  return writeAgentsMdSync(file, altNames);
};

/**
 * Shared reroute injection for the async readers (CC 2.1.199 and 2.1.212+). Both
 * matchers capture the same group layout — [1]=funcName, [2]=pathParam, [3],[4]=the
 * two trailing params, [7]=catchVar, [8]=errorHandler — so the edit itself is
 * identical: add a `didReroute` guard param, then inject the AGENTS.md fallback loop
 * into the reader's catch. A missing CLAUDE.md throws ENOENT from the read path and
 * lands in the catch, which is why the reroute goes there and not the
 * not-a-regular-file branch.
 */
const injectRerouteIntoCatch = (
  file: string,
  m: RegExpMatchArray,
  startIndex: number,
  altNames: string[]
): string => {
  const funcName = m[1];
  const pathParam = m[2];
  const p2 = m[3];
  const p3 = m[4];
  const catchVar = m[7];
  const errorHandler = m[8];

  const altNamesJson = JSON.stringify(altNames);

  const oldSig = `async function ${funcName}(${pathParam},${p2},${p3})`;
  const newSig = `async function ${funcName}(${pathParam},${p2},${p3},didReroute)`;

  const oldCatch = `catch(${catchVar}){return ${errorHandler}(${catchVar},${pathParam}),{info:null,includePaths:[]}}`;
  const reroute =
    `if(!didReroute&&(${pathParam}.endsWith("/CLAUDE.md")||${pathParam}.endsWith("\\\\CLAUDE.md"))){` +
    `for(let alt of ${altNamesJson}){let altPath=${pathParam}.slice(0,-9)+alt;` +
    `try{let _r=await ${funcName}(altPath,${p2},${p3},true);if(_r.info)return _r}catch{}}}`;
  const newCatch = `catch(${catchVar}){${reroute}return ${errorHandler}(${catchVar},${pathParam}),{info:null,includePaths:[]}}`;

  let fn = m[0];
  fn = fn.replace(oldSig, newSig);
  fn = fn.replace(oldCatch, newCatch);

  const endIndex = startIndex + m[0].length;
  const newFile = file.slice(0, startIndex) + fn + file.slice(endIndex);

  showDiff(file, newFile, fn, startIndex, endIndex);

  return newFile;
};

/**
 * CC >=2.1.233: the reader takes a fourth parameter -- a storage descriptor --
 * and when one is supplied it never touches the filesystem at all:
 *
 *   async function W(e,t,n,r){try{let o,s=!1;
 *     if(r){let i=await F(r);switch(i.kind){
 *       case"absent":return{info:null,includePaths:[]};
 *       case"error":return H(i.code,e),{info:null,includePaths:[]};
 *       case"skipped":s=i.isDirectory,o=null;break;
 *       case"content":o=i.content;break}}
 *     else{let i=G();o=await K(i,e,LIMIT,(a)=>{s=a.isDirectory()})}
 *     ...}catch(o){return E(o,e),{info:null,includePaths:[]}}}
 *
 * That kills the catch-clause strategy every older matcher here uses: on the
 * descriptor path a missing CLAUDE.md is `case"absent"`, an ordinary RETURN,
 * and nothing is ever thrown. Injecting into the catch would leave the most
 * common load path -- the one the memory index actually uses -- unpatched,
 * which reads as "AGENTS.md sometimes works" rather than as a failure.
 *
 * So this shape is patched by WRAPPING the reader instead of editing inside
 * it. The wrapper is exit-agnostic: it asks the original for CLAUDE.md, and
 * whichever way the original reports "nothing there" -- absent, error, empty
 * info, or a throw that escapes the reader's own catch -- it then tries the
 * alternates. The initial read is guarded for that last case; the reader
 * converts ordinary filesystem failures to a null-info result itself, so the
 * guard is for the paths it does not convert, and it costs nothing. Every
 * memory file (user, project, local, and each step of the parent-directory
 * walk) is read through this one function, so the wrapper covers all of them.
 *
 * What is load-bearing, and what only looks it:
 *
 *   - LOAD-BEARING. The storage descriptor is DROPPED for the alternates
 *     (`void 0`). A descriptor names one stored key, and the result's identity
 *     comes from the FIRST parameter, so reusing the descriptor would hand
 *     back CLAUDE.md's own bytes labelled with the alternate's path.
 *   - NOT load-bearing, kept for correctness under future shapes. The third
 *     parameter is the caller's symlink-resolved twin of the path, and it is
 *     rewritten to the alternate alongside the first. Traced on 2.1.246: the
 *     reader passes it to the processor, which uses it only as
 *     `dirname(thirdParam)` to resolve `@include` targets. Swapping a filename
 *     inside one directory leaves that dirname identical, so the rewrite is
 *     inert today. It is NOT the reason the alternates resolve correctly --
 *     the descriptor drop is -- and an earlier version of this comment said
 *     otherwise.
 */
const writeAgentsMdWrapper2233 = (
  file: string,
  altNames: string[]
): string | null => {
  const ID = '[$\\w]+';
  const pattern = new RegExp(
    `async function (${ID})\\((${ID}),(${ID}),(${ID}),(${ID})\\)\\{try\\{let (${ID}),(${ID})=!1;` +
      `if\\(\\5\\)\\{let (${ID})=await (${ID})\\(\\5\\);switch\\(\\8\\.kind\\)\\{case"absent":` +
      `return\\{info:null,includePaths:\\[\\]\\};`
  );

  const m = file.match(pattern);
  if (!m || m.index === undefined) return null;

  const [head, funcName, pathParam, typeParam, resolvedParam, descriptorParam] =
    m;
  const inner = `${funcName}$tw`;
  const altNamesJson = JSON.stringify(altNames);

  const wrapper =
    `async function ${funcName}(${pathParam},${typeParam},${resolvedParam},${descriptorParam}){` +
    `let __r=null;try{__r=await ${inner}(${pathParam},${typeParam},${resolvedParam},${descriptorParam})}catch(__e){__r=null}` +
    `if(__r&&__r.info)return __r;` +
    `let __p=String(${pathParam}??"");` +
    `if(!/(^|[\\\\/])CLAUDE\\.md$/.test(__p))return __r;` +
    `let __c=String(${resolvedParam}??"");` +
    `let __sw=(__s,__n)=>/(^|[\\\\/])CLAUDE\\.md$/.test(__s)?__s.slice(0,-9)+__n:__s;` +
    `for(let __n of ${altNamesJson}){` +
    `try{let __x=await ${inner}(__sw(__p,__n),${typeParam},__c?__sw(__c,__n):${resolvedParam},void 0);` +
    `if(__x&&__x.info)return __x}catch{}}` +
    `return __r||{info:null,includePaths:[]}}`;

  const startIndex = m.index;
  const renamedHead = head.replace(
    `async function ${funcName}(`,
    `async function ${inner}(`
  );
  const endIndex = startIndex + head.length;
  const newFile =
    file.slice(0, startIndex) + wrapper + renamedHead + file.slice(endIndex);

  showDiff(file, newFile, wrapper + renamedHead, startIndex, endIndex);

  return newFile;
};

/**
 * CC >=2.1.212 (verified on 2.1.212 and 2.1.214): the reader delegates stat/isFile/
 * size/readFile to a helper, so the older matchers (which expect an inline readFile or
 * a two-declaration `let X=FN(),Y=await FN2(...)` header) no longer match. The reader
 * now reads:
 *   async function W(e,t,r){try{let n=Yt(),o=!1,i=await Yq(n,e,Mlu,(s)=>{o=s.isDirectory()});
 *     if(i===null){...telemetry...return{info:null,includePaths:[]}}
 *     return TAg(i,e,t,r)}catch(n){return CAg(n,e),{info:null,includePaths:[]}}}
 * A missing CLAUDE.md throws ENOENT from the helper's stat() and lands in the catch,
 * so the reroute is injected there (same strategy as writeAgentsMdAsync2199).
 */
const writeAgentsMdAsync2214 = (
  file: string,
  altNames: string[]
): string | null => {
  const pattern =
    /async function ([$\w]+)\(([$\w]+),([$\w]+),([$\w]+)\)\{try\{let [$\w]+=[$\w]+\(\),([$\w]+)=!1,([$\w]+)=await [$\w]+\([$\w]+,\2,[$\w]+,\([$\w]+\)=>\{\5=[$\w]+\.isDirectory\(\)\}\);if\(\6===null\)\{[\s\S]*?return\{info:null,includePaths:\[\]\}\}return [$\w]+\(\6,\2,\3,\4\)\}catch\(([$\w]+)\)\{return ([$\w]+)\(\7,\2\),\{info:null,includePaths:\[\]\}\}\}/;

  const m = file.match(pattern);
  if (!m || m.index === undefined) return null;

  return injectRerouteIntoCatch(file, m, m.index, altNames);
};

const writeAgentsMdAsync2199 = (
  file: string,
  altNames: string[]
): string | null => {
  const pattern =
    /async function ([$\w]+)\(([$\w]+),([$\w]+),([$\w]+)\)\{try\{let [$\w]+=[$\w]+\(\),([$\w]+)=await [$\w]+\(([$\w]+),\2,[$\w]+\);if\(\5===null\)return [$\w]+\(`\[CLAUDE\.md\][^`]*`\),\{info:null,includePaths:\[\]\};return [$\w]+\(\5,\2,\3,\4\)\}catch\(([$\w]+)\)\{return ([$\w]+)\(\7,\2\),\{info:null,includePaths:\[\]\}\}\}/;

  const m = file.match(pattern);
  if (!m || m.index === undefined) return null;

  return injectRerouteIntoCatch(file, m, m.index, altNames);
};

const writeAgentsMdAsync = (
  file: string,
  altNames: string[]
): string | null => {
  // Match the async reader function that:
  // 1. Contains readFile (async)
  // 2. Has a catch block that calls a function with error code checks (ENOENT/EISDIR)
  // 3. Returns {info:null,includePaths:[]}
  const funcPattern =
    /(async function ([$\w]+)\(([$\w]+),([$\w]+),([$\w]+))\)\{try\{let ([$\w]+)=await ([$\w]+)\(\)\.readFile\(\3,\{encoding:"utf-8"\}\);return ([$\w]+)\(\6,\3,\4,\5\)\}catch\(([$\w]+)\)\{return ([$\w]+)\(\9,\3\),\{info:null,includePaths:\[\]\}\}\}/;

  const funcMatch = file.match(funcPattern);
  if (!funcMatch || funcMatch.index === undefined) {
    return null;
  }

  const fullMatch = funcMatch[0];
  const funcSig = funcMatch[1]; // async function NAME(A,q,K
  const funcName = funcMatch[2]; // jh1
  const pathParam = funcMatch[3]; // A
  const typeParam = funcMatch[4]; // q
  const thirdParam = funcMatch[5]; // K
  const readVar = funcMatch[6]; // z
  const fsGetter = funcMatch[7]; // j8
  const processorFunc = funcMatch[8]; // XB9
  const catchVar = funcMatch[9]; // _
  const errorHandler = funcMatch[10]; // DB9

  const altNamesJson = JSON.stringify(altNames);

  const replacement =
    `${funcSig},didReroute){try{let ${readVar}=await ${fsGetter}().readFile(${pathParam},{encoding:"utf-8"});return ${processorFunc}(${readVar},${pathParam},${typeParam},${thirdParam})}catch(${catchVar}){` +
    `if(!didReroute&&(${pathParam}.endsWith("/CLAUDE.md")||${pathParam}.endsWith("\\\\CLAUDE.md"))){` +
    `for(let alt of ${altNamesJson}){` +
    `let altPath=${pathParam}.slice(0,-9)+alt;` +
    `try{let r=await ${funcName}(altPath,${typeParam},${thirdParam},true);if(r.info)return r}catch{}` +
    `}}` +
    `return ${errorHandler}(${catchVar},${pathParam}),{info:null,includePaths:[]}}}`;

  const startIndex = funcMatch.index;
  const endIndex = startIndex + fullMatch.length;

  const newFile =
    file.slice(0, startIndex) + replacement + file.slice(endIndex);

  showDiff(file, newFile, replacement, startIndex, endIndex);

  return newFile;
};

const writeAgentsMdSync = (file: string, altNames: string[]): string | null => {
  const funcPattern =
    /(function ([$\w]+)\(([$\w]+),([^)]+?))\)(?:.|\n){0,500}Skipping non-text file in @include/;

  const funcMatch = file.match(funcPattern);
  if (!funcMatch || funcMatch.index === undefined) {
    console.error('patch: agentsMd: failed to find CLAUDE.md reading function');
    return null;
  }
  const upToFuncParamsClosingParen = funcMatch[1];
  const functionName = funcMatch[2];
  const firstParam = funcMatch[3];
  const restParams = funcMatch[4];
  const funcStart = funcMatch.index;

  const fsPattern = /([$\w]+(?:\(\))?)\.(?:readFileSync|existsSync|statSync)/;
  const fsMatch = funcMatch[0].match(fsPattern);
  let callerFsMatch: RegExpMatchArray | null = null;
  if (!fsMatch) {
    // Try the caller function for fs expression
    const callerSearch = file.slice(Math.max(0, funcStart - 5000), funcStart);
    callerFsMatch = callerSearch.match(fsPattern);
    if (!callerFsMatch) {
      console.error(
        'patch: agentsMd: failed to find fs expression in function or caller'
      );
      return null;
    }
  }

  const fsExpr = fsMatch
    ? fsMatch[1]
    : callerFsMatch
      ? callerFsMatch[1]
      : 'require("fs")';

  const altNamesJson = JSON.stringify(altNames);

  const sigIndex = funcStart + upToFuncParamsClosingParen.length;
  let newFile = file.slice(0, sigIndex) + ',didReroute' + file.slice(sigIndex);

  showDiff(file, newFile, ',didReroute', sigIndex, sigIndex);

  const funcBody = newFile.slice(funcStart);

  const oldEarlyReturnPattern = /\.isFile\(\)\)return null/;
  const newEarlyReturnPattern = /==="EISDIR"\)return null/;

  const earlyReturnMatch =
    funcBody.match(oldEarlyReturnPattern) ??
    funcBody.match(newEarlyReturnPattern);

  if (!earlyReturnMatch || earlyReturnMatch.index === undefined) {
    console.error(
      'patch: agentsMd: failed to find early return null for injection'
    );
    return null;
  }

  const isNewPattern = !funcBody.match(oldEarlyReturnPattern);

  const fallback = `if(!didReroute&&(${firstParam}.endsWith("/CLAUDE.md")||${firstParam}.endsWith("\\\\CLAUDE.md"))){for(let alt of ${altNamesJson}){let altPath=${firstParam}.slice(0,-9)+alt;if(${fsExpr}.existsSync(altPath)&&${fsExpr}.statSync(altPath).isFile())return ${functionName}(altPath,${restParams},true);}}`;

  const earlyReturnStart = funcStart + earlyReturnMatch.index;
  const oldStr = earlyReturnMatch[0];
  const newStr = isNewPattern
    ? `==="EISDIR"){${fallback}return null;}`
    : `.isFile()){${fallback}return null;}`;

  newFile =
    newFile.slice(0, earlyReturnStart) +
    newStr +
    newFile.slice(earlyReturnStart + oldStr.length);

  showDiff(file, newFile, newStr, earlyReturnStart, earlyReturnStart);

  return newFile;
};
