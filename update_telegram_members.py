import asyncio
from datetime import datetime, timezone
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


def get_today_utc():
    """Fecha de hoy en formato YYYY-MM-DD (UTC), igual que el workflow de Facebook."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ====================================
# MAIN
# ====================================
async def update_groups():
    print("📡 Fetching Telegram groups from community_groups (red_social=1)...")

    response = supabase.table("community_groups") \
        .select("id,id_group,nombre,link") \
        .eq("red_social", 1) \
        .limit(1000) \
        .execute()

    groups = response.data
    print(f"✅ {len(groups)} grupos encontrados")

    today = get_today_utc()
    print(f"📅 Fecha del registro: {today}")

    insert_payload = []

    for group in groups:
        try:
            internal_id = group["id"]
            existing_id_group = group.get("id_group")
            name = group["nombre"]
            link = group["link"]

            if not link:
                print(f"⚠️ {name} (id={internal_id}) sin link, omitiendo")
                continue

            print(f"\n➡️ Procesando: {name}")

            entity = await client.get_entity(link)
            full = await client(GetFullChannelRequest(entity))
            members = full.full_chat.participants_count

            # entity.id es el chat ID real de Telegram (lo usamos como id_group)
            telegram_chat_id = entity.id

            print(f"👥 Miembros: {members} | Telegram chat_id: {telegram_chat_id}")

            # Autocompletar id_group en community_groups si está vacío (solo una vez)
            if not existing_id_group:
                supabase.table("community_groups") \
                    .update({"id_group": telegram_chat_id}) \
                    .eq("id", internal_id) \
                    .execute()
                print(f"🆔 id_group autocompletado en community_groups: {telegram_chat_id}")
                id_group_final = telegram_chat_id
            else:
                id_group_final = existing_id_group

            insert_payload.append({
                "id_group": id_group_final,
                "miembros": members,
                "fecha": today,
            })

            print("✅ Listo para insertar histórico")
            await asyncio.sleep(3)

        except Exception as e:
            print(f"❌ Error en {group.get('nombre', 'Grupo Desconocido')}")
            print(str(e))
            continue

    # ====================================
    # INSERT EN BLOQUE — histórico diario
    # ====================================
    if insert_payload:
        print(f"\n🚀 Insertando {len(insert_payload)} registros en insights_crecimiento_acumulado_groups...")
        result = supabase.table("insights_crecimiento_acumulado_groups") \
            .insert(insert_payload) \
            .execute()
        print(f"✅ Inserción completada: {len(result.data)} filas")
    else:
        print("⚠️ No hay registros para insertar")

    # ====================================
    # LOG EN system_logs
    # ====================================
    supabase.table("system_logs").insert({
        "clasificacion": 1,
        "descripcion": "Actualizacion automatica de insight miembros community_usuarios",
        "fecha": today,
    }).execute()
    print("📝 Log registrado en system_logs")


async def main():
    # Iniciamos el cliente usando el archivo de sesión que restauró GitHub Actions
    await client.start()
    await update_groups()
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
