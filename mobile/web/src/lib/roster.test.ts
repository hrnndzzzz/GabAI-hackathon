import { describe, expect, it } from 'vitest'
import { parseRoster } from './roster'

describe('parseRoster', () => {
  it('reads one name per line, any line ending', () => {
    expect(parseRoster('Juan Dela Cruz\r\nMaria Clara\rJose Rizal\n\n')).toEqual(['Juan Dela Cruz', 'Maria Clara', 'Jose Rizal'])
  })

  it('keeps "LAST, FIRST" names whole when there are no columns', () => {
    expect(parseRoster('DELA CRUZ, Juan\nSANTOS, Maria')).toEqual(['DELA CRUZ, Juan', 'SANTOS, Maria'])
  })

  it('drops row numbers, LRNs and sex columns from spreadsheet rows', () => {
    const sheet = '1\t136512100001\tDela Cruz\tJuan\tM\n2\t136512100002\tSantos\tMaria\tF'
    expect(parseRoster(sheet)).toEqual(['Dela Cruz Juan', 'Santos Maria'])
  })

  it('uses a header row to put first names first', () => {
    const sheet = 'No.\tLast Name\tFirst Name\tMiddle Initial\n1\tDela Cruz\tJuan\tP\n2\tSantos\tMaria\t'
    expect(parseRoster(sheet)).toEqual(['Juan P. Dela Cruz', 'Maria Santos'])
  })

  it('reads CSV exports and removes duplicates', () => {
    expect(parseRoster('Name,Section,Sex\nAna Reyes,Mabini,F\nana reyes,Mabini,F\nBen Cruz,Mabini,M')).toEqual(['Ana Reyes', 'Ben Cruz'])
  })
})
