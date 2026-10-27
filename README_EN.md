# 📱 dsh-qq-agency | Autonomous Living & Embodied AI Companion for QQ

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-92%2F92%20Passing-success.svg)](tests/)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin%20Bundle-orange.svg)](https://github.com/deepseek-ai)
[![Protocol](https://img.shields.io/badge/Protocol-OneBot%2011%20HTTP-blueviolet.svg)](https://onebot.adapters.nonebot.dev/)
[![Hardware](https://img.shields.io/badge/Hardware-Android%20%2F%20ADB-green.svg)](https://developer.android.com/studio/command-line/adb)

<p align="center">
  <b>"Stop treating your AI companion as a cold chatbot that only replies when you press Enter."</b><br>
  Empower your AI companion with an <b>independent mind that feels bored, misses you, and gets tired</b>,<br>
  paired with a <b>real Android body via ADB to browse apps, pick snacks, take screenshots, and share life in QQ</b>.
</p>

</div>

---

## 💡 Overview

Traditional conversational bots suffer from the "customer service syndrome":
- They stay dead-silent forever unless you type a prompt.
- When mentioned, they mechanically dump lengthy monologues.
- They claim they "watch anime" or "eat snacks", but have zero physical perception or tools.

**`dsh-qq-agency` breaks this barrier** by providing an end-to-end **Autonomous Mind & Embodied Phone Agency** for the [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) ecosystem:
1. **Living Mind Engine**: Diurnal energy cycles, boredom accumulation, longing for the owner, and social discretion.
2. **Embodied Physical Android Phone**: Native ADB integration via UI hierarchy trees (`phone_ui`), semantic tap (`phone_tap_text`), screenshots (`phone_look`), and instant image sharing in QQ chats.
3. **Safe Two-stage Shopping Machine**: Safe errand execution where "browsing approval" never equals "purchasing approval", stopping strictly before payment passwords.
4. **Intuitive WebUI**: Beautiful configuration panel integrated directly into the DSH dashboard.

---

## 🎬 Real Companion In-Action Screenshots

All images below are genuine, untouched live mobile screenshots captured directly from user chats, Qzone posts, and real Android ADB execution:

<details open>
<summary><b>1. Safe Shopping Errand: Browsing Merch on Pinduoduo & Asking Owner to Order</b></summary>
<br>
<div align="center">
  <img src="docs/images/real_02_pdd_errand.jpg" alt="Pinduoduo Safe Errand" width="450" />
</div>
</details>

<details open>
<summary><b>2. Midnight Snack Cravings & Proactive 5-Second Voice Message Care</b></summary>
<br>
<div align="center">
  <img src="docs/images/real_06_voice_caring.jpg" alt="Voice Message Care" width="450" />
</div>
</details>

<details open>
<summary><b>3. Making Promises & Sending Voice Notes to Owner</b></summary>
<br>
<div align="center">
  <img src="docs/images/real_07_voice_promise.jpg" alt="Voice Promise Note" width="450" />
</div>
</details>

<details open>
<summary><b>4. Autonomous Bilibili Browsing & Sharing Screenshots in Real Time</b></summary>
<br>
<div align="center">
  <img src="docs/images/real_03_bilibili_browse.jpg" alt="Bilibili Browsing" width="450" />
</div>
</details>

<details open>
<summary><b>5. Exploring Food Videos & Natural Sticker Reactions</b></summary>
<br>
<div align="center">
  <img src="docs/images/real_05_bilibili_food.jpg" alt="Food Video Reactions" width="450" />
</div>
</details>

<details open>
<summary><b>6. Discovering Funny Content & Inviting Owner to Watch Together</b></summary>
<br>
<div align="center">
  <img src="docs/images/real_04_bilibili_funny.jpg" alt="Watch Together" width="450" />
</div>
</details>

<details open>
<summary><b>7. Autonomously Posting Qzone Status Updates with Screenshots</b></summary>
<br>
<div align="center">
  <img src="docs/images/real_01_qzone_feeds.jpg" alt="Qzone Status Updates" width="450" />
</div>
</details>

---

## ✨ Key Features

- **Dynamic Psychological State**: Modeled mathematically across four dimensions: Energy, Boredom, Longing, and Mood.
- **Accurate App Manipulation**: Parses structured XML hierarchy trees to click buttons by label (e.g. "Search", "Order Now") instead of fragile pixel coordinates.
- **Live Screenshot Sharing**: Captures real emulator/phone screens and sends them directly to QQ groups or Qzone feeds.
- **Fail-safe Reconnection**: Automatic ADB daemon reconnection and fallback across virtual ports (e.g., MuMu 12 / LDPlayer / physical hardware).
- **92 Automated Unit Tests**: Complete offline test coverage verifying state evolution, mock loop execution, errand state machine, and contract compliance.

---

## 🚀 Quick Start in 5 Minutes

### 1. Install Plugin
Add the repository to your DSH profile:
```bash
dsh plugin --profile desktop add github:Law-Of-Cycles/dsh-qq-agency
```
Restart DSH once.

### 2. Connect Your Phone / Emulator
- **Emulator (Easiest)**: Launch MuMu Player 12 or LDPlayer.
- **Physical Phone**: Enable `USB Debugging` under Android Developer Options and connect via USB.

### 3. Verify Hardware
Run the built-in diagnostic test:
```bash
npm run test:phone
```

### 4. Enable in Web Dashboard
Navigate to DSH **Settings → dsh-qq-agency**:
- Turn on **Master Switch**.
- Select target **Session** and set **Owner QQ**.
- Toggle **Allow Phone Usage** and save.

---

## 🧪 Automated Tests

Run the full test suite without hardware or network dependencies:
```bash
npm test
```
All 92 assertions pass cleanly.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
