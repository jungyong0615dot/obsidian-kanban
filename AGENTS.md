# AGENTS.md

이 레포에서 작업할 때는 vault 경로를 실행 환경에 맞춰 구분한다.

- 현재 실행 환경은 vault 작업 전에 먼저 구분한다.
  - `pwd`가 `/Users/jungyong/...` 아래이거나 `uname` 결과가 `Darwin`이면 MacBook Pro 환경으로 본다.
  - `pwd`가 `/data/data/com.termux/...` 아래이거나 `$PREFIX`가 `/data/data/com.termux/files/usr`이면 Termux/Android 환경으로 본다.
  - 둘 중 어느 쪽인지 애매하면 vault에 쓰기 작업을 하지 말고 먼저 사용자에게 확인한다.
- vault 경로는 현재 실행 환경에 맞춰 구분해서 사용한다.
- MacBook Pro 환경:
  - 테스트용 vault 경로는 `/Users/jungyong/org/test_vault` 이다.
  - prod vault 경로는 `/Users/jungyong/org/jy_daily/jynote` 이다.
- Termux/Android 환경:
  - 테스트용 vault 경로는 `/data/data/com.termux/files/home/storage/shared/syncthing/org/test_vault` 이다.
  - prod vault 경로는 `/storage/emulated/0/syncthing/org/jy_daily/jynote` 이다.
- 사용자가 test vault를 말하면 현재 환경의 테스트용 vault만 사용하고, prod vault는 명시적으로 요청받은 경우에만 사용한다.
