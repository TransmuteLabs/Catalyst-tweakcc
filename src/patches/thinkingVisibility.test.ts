import { describe, it, expect } from 'vitest';
import { writeThinkingVisibility } from './thinkingVisibility';

const cc209 =
  'function Vwd(WM,dq,Ilt,fJ,nLt,up,xir){switch(WM.type){' +
  'case"thinking":{if(!Ilt&&!fJ){return null}' +
  'let I4;if(nLt[32]!==dq||nLt[35]!==fJ)I4=up.jsx(xir,{addMargin:dq,param:WM,' +
  'isTranscriptMode:Ilt,verbose:fJ}),nLt[32]=dq,nLt[36]=I4;else I4=nLt[36];return I4}' +
  'default:{return null}}}' +
  'function oTd(e,t){let r=[];if(r.length===0)return null;' +
  'return Ea.jsx(Ea.Fragment,{children:r})}' +
  'function Llt(e,{tools:t,verbose:r,inProgressToolCallCount:o,isTranscriptMode:i=!1}){' +
  'if(!e.length)return Ea.jsx(fr,{height:1,children:null});return i}';

const cc205 =
  'function R(A,B,V,I){switch(A.type){' +
  'case"thinking":if(!V&&!I)return null;' +
  'return w3.createElement(Q$Q,{addMargin:B,param:A,isTranscriptMode:V,verbose:I});' +
  'default:return null}}';

const bracedSemicolon =
  'function R(A,B,V,I){switch(A.type){' +
  'case"thinking":{if(!V&&!I){return null;}' +
  'let k;k=w3.createElement(Q$Q,{addMargin:B,param:A,isTranscriptMode:V,verbose:I});return k}' +
  'default:{return null}}}';

// 2.1.239 moved a sibling branch (the shouldShowDot element) in between the
// case and the guard, and dropped the comma after `verbose:` because the prop
// is last in the object. Both together are what stopped the old locator.
const cc239 =
  'function Vwd(WM,dq,Ilt,fJ,nLt,up,xir,dot){switch(WM.type){' +
  'case"thinking":{if(dot!==null&&xir!==null&&dot(WM)){let z;' +
  'if(nLt[30]!==dq)z=up.jsx(xir,{param:WM,addMargin:dq,shouldShowDot:!0}),nLt[31]=z;' +
  'else z=nLt[31];return z}' +
  'if(!Ilt&&!fJ){return null}' +
  'let I4;if(nLt[32]!==dq||nLt[35]!==fJ)I4=up.jsx(xir,{addMargin:dq,param:WM,' +
  'isTranscriptMode:Ilt,verbose:fJ}),nLt[32]=dq,nLt[36]=I4;else I4=nLt[36];return I4}' +
  'default:{return null}}}';

// Two thinking cases carrying the same guard/element pair: the patch has no way
// to tell which one the user meant, so it must refuse instead of unhiding one.
const twoCandidates = cc239 + cc239.replace('function Vwd', 'function Vwe');

const unrecognisedEarlyReturn =
  'function Vwd(WM,dq,Ilt,fJ,up,xir){switch(WM.type){' +
  'case"thinking":{if(!Ilt&&!fJ){return void 0}' +
  'let I4;I4=up.jsx(xir,{addMargin:dq,isTranscriptMode:Ilt,verbose:fJ});return I4}' +
  'default:{return null}}}' +
  'function oTd(e,q,z){let r=[];if(r.length===0)return null;' +
  'return Ea.jsx(F,{children:r,isTranscriptMode:q,verbose:z})}';

describe('thinkingVisibility', () => {
  describe('writeThinkingVisibility', () => {
    it('should not produce a syntax error on the CC 2.1.209 braces shape', () => {
      const result = writeThinkingVisibility(cc209);

      expect(result).not.toBeNull();
      expect(() => new Function(result as string)).not.toThrow();
    });

    it('should force isTranscriptMode true and drop the early return on 2.1.209', () => {
      const result = writeThinkingVisibility(cc209) as string;

      expect(result).toContain('isTranscriptMode:true,verbose:fJ');
      expect(result).not.toContain('if(!Ilt&&!fJ){return null}');
    });

    it('should not delete unrelated code that follows the thinking case on 2.1.209', () => {
      const result = writeThinkingVisibility(cc209) as string;

      expect(result).toContain('function oTd(e,t)');
      expect(result).toContain('if(r.length===0)return null;');
      expect(result).toContain('isTranscriptMode:i=!1');
      expect(result).toContain('I4=up.jsx(xir,{addMargin:dq,param:WM,');
    });

    it('should patch the 2.1.239 shape, where a sibling branch precedes the guard', () => {
      const result = writeThinkingVisibility(cc239);

      expect(result).not.toBeNull();
      const out = result as string;
      expect(out).toContain('isTranscriptMode:true,verbose:fJ');
      expect(out).not.toContain('if(!Ilt&&!fJ){return null}');
      // the sibling branch is carried over untouched
      expect(out).toContain('shouldShowDot:!0');
      expect(() => new Function(out)).not.toThrow();
    });

    it('should refuse when two thinking cases share the same guard/element pair', () => {
      expect(writeThinkingVisibility(twoCandidates)).toBeNull();
    });

    it('should still patch the CC 2.0.50 semicolon shape', () => {
      const result = writeThinkingVisibility(cc205);

      expect(result).not.toBeNull();
      expect(result as string).toContain('isTranscriptMode:true,verbose:I');
      expect(result as string).not.toContain('if(!V&&!I)return null;');
      expect(() => new Function(result as string)).not.toThrow();
    });

    it('should keep braces balanced when the early return is `{return null;}`', () => {
      const result = writeThinkingVisibility(bracedSemicolon);

      expect(result).not.toBeNull();
      const out = result as string;
      expect(out).not.toContain('case"thinking":{}');
      expect((out.match(/\{/g) ?? []).length).toBe(
        (out.match(/\}/g) ?? []).length
      );
      expect(() => new Function(out)).not.toThrow();
    });

    it('should decline to patch an unrecognised early-return shape rather than match a distant one', () => {
      expect(writeThinkingVisibility(unrecognisedEarlyReturn)).toBeNull();
    });

    it('should return null when the thinking case is absent', () => {
      expect(writeThinkingVisibility('function f(){return 1}')).toBeNull();
    });
  });
});
