# Lista popularnych haseł

**Cel:** dostarczyć lokalną listę odmowy dla AUTH §2 i BL-101, bez zapytań sieciowych podczas testów.

Źródło: [SecLists, 10k-most-common.txt](https://github.com/danielmiessler/SecLists/blob/913b327317496d062bcc7cace524aaad8a693be2/Passwords/Common-Credentials/10k-most-common.txt), pobrane 2026-10-03. Zachowano oryginalny plik (10001 wierszy); polityka używa pierwszych 10000 niepustych wpisów. Licencja MIT znajduje się w `seclists-license.txt`. To publiczny zbiór słownikowy do odrzucania haseł, nie poświadczenia instancji.

HIBP używa eksportu `isPasswordCompromised` wtyczki Better Auth; tylko prefiks SHA-1 opuszcza proces. Adapter polityki przechwytuje niedostępność dostawcy zgodnie z AUTH §2, pozostawiając sprawdzenie offline. Testy wstrzykują dostawcę bez sieci.
