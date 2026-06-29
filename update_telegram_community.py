import asyncio
from datetime import datetime, timezone
from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest
from supabase import create_client
import os

api_id = int(os.getenv("TELEGRAM_API_ID"))
api_hash = os.getenv("TELEGRAM_API_HASH")

client = TelegramClient("telegram", api_id, api_hash)

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)


def get_today_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def update_groups(today):
    print("📡 Fetching Telegram groups from community_groups (red_social=1)...")

    response = supabase.table("community_groups") \
        .select("id,id_group,nombre,link") \
        .eq("red_social", 1) \
        .limit(1000) \
        .execute()

    groups = response.data
    print(f"✅ {len(groups)} grupos encontrados")

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

            print(f"\n➡️ Procesando grupo: {name}")

            entity = await client.get_entity(link)
            full = await client(GetFullChannelRequest(entity))
            members = full.full_chat.participants_count
            telegram_chat_id = entity.id

            print(f"👥 Miembros: {members} | Telegram chat_id: {telegram_chat_id}")

            if not existing_id_group:
                supabase.table("community_groups") \
                    .update({"id_group": telegram_chat_id}) \
                    .eq("id", internal_id) \
                    .execute()
                print(f"🆔 id_group autocompletado: {telegram_chat_id}")
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
            print(f"❌ Error en grupo {group.get('nombre', 'Desconocido')}")
            print(str(e))
            continue

    if insert_payload:
        print(f"\n🚀 Insertando {len(insert_payload)} registros en insights_crecimiento_acumulado_groups...")
        result = supabase.table("insights_crecimiento_acumulado_groups") \
            .insert(insert_payload) \
            .execute()
        print(f"✅ Inserción completada: {len(result.data)} filas")
    else:
        print("⚠️ No hay registros de grupos para insertar")

    supabase.table("system_logs").insert({
        "clasificacion": 1,
        "modulo": 1,
        "descripcion": "Actualizacion automatica de insight miembros community_groups (Telegram)",
        "fecha": today,
    }).execute()
    print("📝 Log de grupos registrado en system_logs")


async def update_channels(today):
    print("\n📡 Fetching Telegram channels from community-channels...")

    response = supabase.table("community-channels") \
        .select("id,nombre,link,suscriptores,red_social") \
        .eq("red_social", 1) \
        .limit(1000) \
        .execute()

    channels = response.data
    print(f"✅ {len(channels)} canales encontrados")

    insert_payload = []

    for channel in channels:
        try:
            internal_id = channel["id"]
            name = channel["nombre"]
            link = channel["link"]

            if not link:
                print(f"⚠️ {name} (id={internal_id}) sin link, omitiendo")
                continue

            print(f"\n➡️ Procesando canal: {name}")

            entity = await client.get_entity(link)
            full = await client(GetFullChannelRequest(entity))
            subscribers = full.full_chat.participants_count

            print(f"📣 Suscriptores: {subscribers}")

            supabase.table("community-channels") \
                .update({"suscriptores": subscribers}) \
                .eq("id", internal_id) \
                .execute()

            insert_payload.append({
                "id_channel": internal_id,
                "suscriptores": subscribers,
                "fecha": today,
            })

            print("✅ Listo para insertar histórico")
            await asyncio.sleep(3)

        except Exception as e:
            print(f"❌ Error en canal {channel.get('nombre', 'Desconocido')}")
            print(str(e))
            continue

    if insert_payload:
        print(f"\n🚀 Insertando {len(insert_payload)} registros en insights_crecimiento_acumulado_channels...")
        result = supabase.table("insights_crecimiento_acumulado_channels") \
            .insert(insert_payload) \
            .execute()
        print(f"✅ Inserción completada: {len(result.data)} filas")
    else:
        print("⚠️ No hay registros de canales para insertar")

    supabase.table("system_logs").insert({
        "clasificacion": 1,
        "modulo": 1,
        "descripcion": "Actualizacion automatica de insight suscriptores community-channels (Telegram)",
        "fecha": today,
    }).execute()
    print("📝 Log de canales registrado en system_logs")


async def main():
    today = get_today_utc()
    print(f"📅 Fecha del registro: {today}\n")

    await client.start()
    await update_groups(today)
    await update_channels(today)
    await client.disconnect()

    print("\n🎉 Proceso completo: grupos y canales actualizados")


if __name__ == "__main__":
    asyncio.run(main())
