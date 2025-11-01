import {bufferToTags, tagsToBuffer} from "../tagUtil.ts";

class FakeModule {
  _theText:string;
  
  constructor(text:string = '') { this._theText = text; }
  
  allocateUTF8(text:string):number {
    this._theText = text;
    return text.length;
  }
  
  UTF8ToString(_pBuffer:number):string {
    return this._theText;
  }
}

describe('tagUtil', () => {
  describe('tagsToBuffer()', () => {
    let module:FakeModule = new FakeModule();
    
    beforeEach(() => {
      module = new FakeModule();
    });
    
    it('should return empty string when tags is empty', () => {
      expect(tagsToBuffer([], module)).toBeDefined();
      expect(module._theText).toBe('');
    });
    
    it('returns a string with one tag', () => {
      const tags = [{name: 'name1', value: 'value1'}];
      expect(tagsToBuffer(tags, module)).toBeDefined();
      expect(module._theText).toBe('name1=value1');
    });
    
    it('returns a string with two tags', () => {
      const tags = [{name: 'name1', value: 'value1'}, {name: 'name2', value: 'value2'}];
      expect(tagsToBuffer(tags, module)).toBeDefined();
      expect(module._theText).toBe('name1=value1\tname2=value2');
    });
    
    it('returns a string with empty value', () => {
      const tags = [{name: 'name1', value: ''}];
      expect(tagsToBuffer(tags, module)).toBeDefined();
      expect(module._theText).toBe('name1=');
    });
    
    it('returns a value with an equal sign', () => {
      const tags = [{name: 'name1', value: 'value=1'}];
      expect(tagsToBuffer(tags, module)).toBeDefined();
      expect(module._theText).toBe('name1=value=1');
    });
    
    it('throws if name contains an equal sign', () => {
      const tags = [{name: 'name=1', value: 'value1'}];
      expect(() => tagsToBuffer(tags, module)).toThrow();
    });
    
    it('throws if name contains a tab', () => {
      const tags = [{name: 'name\t1', value: 'value1'}];
      expect(() => tagsToBuffer(tags, module)).toThrow();
    });
    
    it('throws if value contains a tab', () => {
      const tags = [{name: 'name1', value: 'value\t1'}];
      expect(() => tagsToBuffer(tags, module)).toThrow();
    });
  });
  
  describe('bufferToTags()', () => {
    it('returns empty array when passed an empty buffer', () => {
      const module = new FakeModule();
      expect(bufferToTags(0, module)).toEqual([]);
    });

    it('returns empty array when passed null', () => {
      const module = new FakeModule();
      expect(bufferToTags(null, module)).toEqual([]);
    });
    
    it('returns a tag from a buffer', () => {
      const module = new FakeModule('name1=value1');
      const expected = [{name: 'name1', value: 'value1'}];
      expect(bufferToTags(0, module)).toEqual(expected);
    });
    
    it('returns two tags from a buffer', () => {
      const module = new FakeModule('name1=value1\tname2=value2');
      const expected = [{name: 'name1', value: 'value1'}, {name: 'name2', value: 'value2'}];
      expect(bufferToTags(0, module)).toEqual(expected);
    });
    
    it('returns a tag with an empty value', () => {
      const module = new FakeModule('name1=');
      const expected = [{name: 'name1', value: ''}];
      expect(bufferToTags(0, module)).toEqual(expected);
    });
    
    it('returns a tag with an equal sign in the value', () => {
      const module = new FakeModule('name1=value=1');
      const expected = [{name: 'name1', value: 'value=1'}];
      expect(bufferToTags(0, module)).toEqual(expected);
    });
    
    it('returns a tag that is missing an equal sign in encoding', () => {
      const module = new FakeModule('name1');
      const expected = [{name: 'name1', value: ''}];
      expect(bufferToTags(0, module)).toEqual(expected);
    });
  });
});