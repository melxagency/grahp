import asyncio
from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest
from supabase import create_client
import os

# ====================================

# TELEGRAM

# ====================================

api_id = int(os.getenv("TELEGRAM_API_ID"))
api_hash = os.getenv("TELEGRAM_API_HASH")

client = TelegramClient(
"telegram",
api_id,
api_hash
)

# ====================================

# SUPABASE

# ====================================

supabase = create_client(
os.getenv("SUPABASE_URL"),
os.getenv("SUPABASE_KEY")
)

# ====================================

# MAIN

# ====================================

async def update_groups():

```
print("📡 Fetching groups from Supabase...")

response = supabase.table("telegram_groups") \
    .select("id,nombre,link") \
    .limit(1000) \
    .execute()

groups = response.data

print(f"✅ {len(groups)} grupos encontrados")

for group in groups:

    try:

        group_id = group["id"]
        name = group["nombre"]
        link = group["link"]

        print(f"\n➡️ Procesando: {name}")

        entity = await client.get_entity(link)

        full = await client(GetFullChannelRequest(entity))

        members = full.full_chat.participants_count

        print(f"👥 Miembros: {members}")

        supabase.table("telegram_groups") \
            .update({
                "miembros_actuales": members
            }) \
            .eq("id", group_id) \
            .execute()

        print("✅ Actualizado")

        await asyncio.sleep(3)

    except Exception as e:

        print(f"❌ Error en {group['nombre']}")
        print(str(e))

        continue
```

async def main():

```
await client.start()

await update_groups()

await client.disconnect()
```

asyncio.run(main())
