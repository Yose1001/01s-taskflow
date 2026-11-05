# TaskFlow

เว็บแอปจัดการโปรเจกต์และงานแบบ Kanban สำหรับทีมเล็ก
Go + React + PostgreSQL | ธีมพาสเทล (สว่าง/มืด) | UI ไทย/อังกฤษ | ถังขยะกู้คืนได้ 30 วัน

## เอกสาร
- [Requirements](docs/01-requirements.md)
- [ER diagram](docs/02-er-diagram.md)
- [API contract (OpenAPI)](docs/openapi.yaml)
- [ADR: tech stack](docs/adr/0001-tech-stack.md)

## โครงสร้าง
```
backend/    Go API  (cmd/api, internal/{config,handler,service,repository,model,middleware,router}, migrations)
frontend/   React + TypeScript + Vite
docs/       เอกสารและ API contract
.github/    CI, CODEOWNERS, PR template
```

## เริ่มใช้งาน (ในเทอร์มินัล Ubuntu/WSL)
ต้องมี: Go 1.27+, Node 24 LTS, pnpm, Docker

```bash
cp .env.example .env     # แล้วแก้ค่าให้เหมาะสม (ห้าม commit .env)
make db-up               # เปิด PostgreSQL
make run-backend         # API ที่ http://localhost:8080/api/v1/health
make run-frontend        # เว็บที่ http://localhost:5173
make test                # รัน test ทั้งหมด
make help                # ดูคำสั่งทั้งหมด
```

## กติกาการทำงาน
- ห้าม push เข้า `main` ตรง ๆ: ทำใน branch `feature/*` หรือ `fix/*` แล้วเปิด Pull Request
- commit แบบ Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`
- PR ต้องผ่าน CI และมีการ review ก่อน merge
- ห้ามใส่ secret ในโค้ดหรือ git; ใช้ `.env` (อยู่ใน `.gitignore`)
- เก็บโปรเจกต์ในดิสก์ของ Linux (`~/projects`) ไม่ใช่ `/mnt/c`
