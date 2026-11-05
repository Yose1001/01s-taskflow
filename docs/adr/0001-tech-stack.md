# ADR-0001: เลือก Tech Stack ของ TaskFlow

- สถานะ: **เสนอ** (รออนุมัติ)
- วันที่: 2026-11-05

## บริบท
ต้องการโปรเจกต์ฝึกที่ทำงานแบบมาตรฐานบริษัท รันบน Windows 11 ผ่าน WSL2 (Ubuntu) โดยมี Go 1.27, Node 24 LTS, pnpm และ Docker พร้อมใช้งานแล้ว

## การตัดสินใจ
| ด้าน | เลือก | เหตุผลย่อ |
|---|---|---|
| Backend | Go + `chi` router | เบา ใช้ `net/http` มาตรฐาน เรียนรู้ง่าย |
| ฐานข้อมูล | PostgreSQL 16 (Docker) | ใกล้เคียง production รองรับ constraint/index ที่ต้องใช้ |
| Data access | `pgx` + `sqlc` | SQL ชัดเจน type-safe ไม่ต้องใช้ ORM |
| Migration | `golang-migrate` | มาตรฐานและใช้ใน CI ได้ |
| Auth | JWT (access token) + argon2id/bcrypt | เรียบง่ายสำหรับ MVP; refresh token ทำภายหลัง |
| Frontend | React 18+ + TypeScript + Vite | เร็ว ผู้ใช้เยอะ เอกสารเยอะ |
| Server state | TanStack Query | จัดการ cache/loading/error ของ API |
| Styling | Tailwind CSS | เขียนเร็ว สม่ำเสมอ |
| Drag-and-drop | dnd-kit | รองรับ keyboard/accessibility |
| ธีมสี | Design token เป็น CSS variables + Tailwind `darkMode: 'class'` (ตั้ง `data-theme` ที่ `<html>`) | สลับสว่าง/มืด/ตามระบบได้จากชุดสีเดียว; สคริปต์เล็กใน `index.html` ตั้งธีมก่อนวาดหน้าเพื่อกันกระพริบ |
| พาสเทล | พาเลตต์พาสเทลสองชุด (สว่าง/มืด) ตรวจ contrast ≥ 4.5:1 | พาสเทลมักตัวอักษรอ่านยาก; ใช้สีพาสเทลเป็นพื้น/การ์ด และใช้สีเข้มกว่าสำหรับตัวอักษร |
| หลายภาษา | `react-i18next` + ไฟล์ `locales/th.json`, `locales/en.json`; `Intl` สำหรับวันที่/ตัวเลข | มาตรฐาน รองรับสลับทันที; Backend ส่ง error code ให้ frontend แปล |
| เก็บการตั้งค่า | `users.locale`, `users.theme` + `localStorage` เป็น cache ก่อนล็อกอิน | ล็อกอินเครื่องอื่นได้ค่าเดิม |
| ถังขยะ | Soft delete (`deleted_at`) + purge job รายวัน (goroutine ตั้งเวลาใน API) ใช้ `pg_try_advisory_lock` กันรันซ้ำหลายอินสแตนซ์ | เรียบง่าย ไม่ต้องมีบริการเสริม; ย้ายไป cron/worker แยกได้ภายหลัง |
| API contract | OpenAPI 3.0 (`docs/openapi.yaml`) | ตกลงรูปแบบก่อนเขียนโค้ด |
| Repo | Monorepo `backend/` + `frontend/` | จัดการ PR และ CI ที่เดียว |

## ผลที่ตามมา
- ต้องเรียนรู้ sqlc และ golang-migrate เพิ่ม แลกกับ SQL ที่ตรวจสอบได้
- ใช้ JWT อย่างเดียวทำให้ยกเลิก token ก่อนหมดอายุไม่ได้ (ยอมรับได้ใน MVP)
- `position` แบบทศนิยมอาจต้อง rebalance เมื่อค่าละเอียดเกินไป (ทำภายหลัง)
- Soft delete ทำให้ทุก query ต้องกรอง `deleted_at IS NULL` ถ้าลืมจะเห็นข้อมูลที่ลบแล้ว จึงรวมไว้ใน repository จุดเดียว และเขียน test ครอบคลุม
- Purge job เป็นการลบถาวรที่กู้ไม่ได้ ต้องมี test ที่ควบคุมเวลาได้ และลบเป็นชุดเล็ก ๆ พร้อม log จำนวนที่ลบ
- ต้องดูแลไฟล์แปลสองภาษาให้ครบเท่ากัน (ตรวจใน CI ว่า key ตรงกัน) และตรวจ contrast ของพาสเทลในทั้งสองโหมด

## ทางเลือกที่ไม่เลือก
- **GORM:** สะดวกแต่ซ่อน SQL ทำให้เรียนรู้และตรวจสอบยากกว่า
- **SQLite:** ง่ายกว่า แต่ต่างจาก production และฝึก constraint/index ได้น้อยกว่า
- **ฝังสีแบบ hard-code ต่อคอมโพเนนต์:** แก้ธีมทั้งแอปยากและสลับโหมดไม่สม่ำเสมอ
- **Cron ภายนอก/worker แยกสำหรับ purge:** แข็งแรงกว่า แต่เกินความจำเป็นของ MVP
- **Next.js:** เกินความจำเป็นเมื่อ backend เป็น Go แยกอยู่แล้ว
