import {expect,test} from 'vitest';
import {quickTransactionInput,normalizeQuickDecimal} from '../src/contracts.js';
test('quick money accepts text only, normalizes separators without float',()=>{
  expect(normalizeQuickDecimal('99999999999999,1234567890')).toBe('99999999999999.123456789');
  expect(normalizeQuickDecimal('0001.50')).toBe('1.5');
  for(const price of [1.2,'1e3','-1','1,2.3','Infinity',' 1']){
    expect(quickTransactionInput.safeParse({ticker:'SYN',side:'BUY',quantity:'1',price}).success).toBe(false);
  }
  expect(quickTransactionInput.safeParse({ticker:'SYN',side:'BUY',quantity:'1',price:'1',fee:'0',extra:1}).success).toBe(false);
});
