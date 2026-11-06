# TaskFlow: ER Diagram (ฉบับร่าง v0.2)

```mermaid
erDiagram
    users ||--o{ project_members : "เป็นสมาชิก"
    projects ||--o{ project_members : "มีสมาชิก"
    projects ||--o{ tasks : "มีงาน"
    users ||--o{ tasks : "ได้รับมอบหมาย (assignee)"
    users ||--o{ tasks : "สร้าง (created_by)"
    users ||--o{ projects : "เป็นเจ้าของ (owner)"

    users {
        uuid id PK
        text email UK "lowercase, unique"
        text password_hash
        text display_name
        text locale "th | en (default en)"
        text theme "light | dark (default light)"
        timestamptz created_at
    }
    projects {
        uuid id PK
        text name
        text description
        uuid owner_id FK
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at "null = ปกติ; มีค่า = อยู่ในถังขยะ"
        uuid deleted_by FK "nullable"
    }
    project_members {
        uuid project_id PK, FK
        uuid user_id PK, FK
        text role "owner | member"
        timestamptz joined_at
    }
    tasks {
        uuid id PK
        uuid project_id FK
        text title
        text description
        text status "todo | in_progress | review | done"
        text priority "low | medium | high"
        uuid assignee_id FK "nullable"
        uuid created_by FK
        date due_date "nullable"
        double position "เรียงลำดับในคอลัมน์"
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at "null = ปกติ; มีค่า = อยู่ในถังขยะ"
        uuid deleted_by FK "nullable"
    }
```

## กติกาของข้อมูล
- `project_members` ใช้ primary key คู่ (`project_id`, `user_id`)
- Owner ต้องมีแถวใน `project_members` ที่ `role = 'owner'` เสมอ (สร้างพร้อมโปรเจกต์ใน transaction เดียว)
- `tasks.assignee_id` ต้องเป็นสมาชิกของ `tasks.project_id` (ตรวจใน service และเสริมด้วย composite foreign key ได้ภายหลัง)
- `tasks.position` เป็นเลขทศนิยม: ย้ายงานไปแทรกระหว่างสองใบใช้ค่าเฉลี่ยของ position เพื่อไม่ต้องเขียนทับทั้งคอลัมน์
- ดัชนีที่ควรมี: `users(email)`, `tasks(project_id, status, position) WHERE deleted_at IS NULL` (partial index), `tasks(assignee_id)`, `project_members(user_id)`, `tasks(deleted_at) WHERE deleted_at IS NOT NULL` และ `projects(deleted_at) WHERE deleted_at IS NOT NULL` (ให้งานลบถาวรหาแถวหมดอายุได้เร็ว)
- ใช้ CHECK constraint กับ `status`, `priority`, `role`, `locale`, `theme`

## ถังขยะ (soft delete 30 วัน)
- ทุก query ปกติของ `tasks` และ `projects` ต้องมีเงื่อนไข `deleted_at IS NULL` (ควรห่อไว้ใน repository จุดเดียว กันลืม)
- งานในโปรเจกต์ที่ถูกลบ ไม่ต้องตั้ง `deleted_at` ทีละใบ ซ่อนตามสถานะโปรเจกต์ (ตรวจ `projects.deleted_at` ตอน join)
- **กู้คืน:** ตั้ง `deleted_at = NULL, deleted_by = NULL` ใน transaction เดียว ถ้า `assignee_id` ไม่ได้เป็นสมาชิกแล้วให้ตั้งเป็น NULL
- **ลบถาวร (purge job รายวัน):** ลบแถวที่ `deleted_at < now() - interval '30 days'` เป็นชุดเล็ก ๆ (batch) ใน transaction ลบ `tasks` ก่อน แล้ว `projects` ที่หมดอายุ (การลบโปรเจกต์ถาวรต้องลบงานและสมาชิกทั้งหมดของมันด้วย `ON DELETE CASCADE` หรือสั่งลบตามลำดับ)
- ระยะเก็บมาจาก config `TRASH_RETENTION_DAYS` (ค่าเริ่มต้น 30) ไม่ฝังตัวเลขในโค้ด
- `deleted_by` และ `assignee_id` ใช้ `ON DELETE SET NULL` (MVP ยังไม่มีฟีเจอร์ลบผู้ใช้ แต่กันไว้ไม่ให้ติดข้อจำกัดภายหลัง)
