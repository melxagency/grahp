import asyncio
import os
from datetime import datetime, timezone

from telethon import TelegramClient
from supabase import create_client

api_id = int(os.getenv("TELEGRAM_API_ID"))
api_hash = os.getenv("TELEGRAM_API_HASH")

client = TelegramClient("telegram", api_id, api_hash)

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

MENSAJES_POR_CANAL = int(os.getenv("MENSAJES_POR_CANAL", "50"))


def get_today_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def get_telegram_channels():
    """Obtiene los channels de Telegram (red_social = 1) desde community-channels."""
    response = supabase.table("community-channels") \
        .select("id,nombre,link") \
        .eq("red_social", 1) \
        .limit(1000) \
        .execute()
    return response.data


def get_channel_services_map(today):
    """
    Devuelve dict {id_channel: id_channel_services} solo para los channels que
    tienen un servicio/contrato activo en services_channels (fecha_inicio <= hoy
    y fecha_termino nulo o >= hoy).
    """
    response = supabase.table("services_channels") \
        .select("id,id_channel,fecha_inicio,fecha_termino") \
        .lte("fecha_inicio", today) \
        .execute()

    mapa = {}
    for row in response.data:
        fecha_termino = row.get("fecha_termino")
        if fecha_termino is not None and fecha_termino < today:
            continue
        actual = mapa.get(row["id_channel"])
        if actual is None or row["fecha_inicio"] >= actual["fecha_inicio"]:
            mapa[row["id_channel"]] = row

    return {id_channel: row["id"] for id_channel, row in mapa.items()}


def get_registros_channel(channel_id):
    """Devuelve dict {post_id: {"id":..., "id_channel_services":...}} para este channel."""
    response = supabase.table("oper_registro_post_channels") \
        .select("id,post_id,id_channel_services") \
        .eq("channel", channel_id) \
        .execute()
    return {
        row["post_id"]: {"id": row["id"], "id_channel_services": row["id_channel_services"]}
        for row in response.data
    }


def upsert_post_y_obtener_id(channel_id, id_channel_services, post_id, fecha):
    """Inserta o ignora el post en oper_registro_post_channels y devuelve su id."""
    supabase.table("oper_registro_post_channels").upsert({
        "channel": channel_id,
        "id_channel_services": id_channel_services,
        "fecha_inicio": fecha,
        "post_id": post_id,
        "activo": True,
        "fecha_final": None,
    }, on_conflict="channel,post_id").execute()

    registro = supabase.table("oper_registro_post_channels") \
        .select("id") \
        .eq("channel", channel_id) \
        .eq("post_id", post_id) \
        .single() \
        .execute()

    return registro.data["id"]


def sincronizar_id_channel_services(id_registro, id_channel_services):
    """Actualiza id_channel_services de un registro ya existente si quedó desactualizado."""
    supabase.table("oper_registro_post_channels") \
        .update({"id_channel_services": id_channel_services}) \
        .eq("id", id_registro) \
        .execute()


async def procesar_channel(channel, today, id_channel_services, insights_payload):
    nombre = channel["nombre"]
    link = channel.get("link")
    channel_id = channel["id"]

    if not link:
        print(f"⚠️ {nombre} (id={channel_id}) sin link, omitiendo")
        return

    print(f"\n➡️ Procesando channel: {nombre} ({link}) [id_channel_services={id_channel_services}]")

    try:
        entity = await client.get_entity(link)
    except Exception as e:
        print(f"❌ No se pudo obtener el channel {nombre}: {e}")
        return

    registrados = get_registros_channel(channel_id)
    nuevos = 0
    revisados = 0

    async for mensaje in client.iter_messages(entity, limit=MENSAJES_POR_CANAL):
        if mensaje.views is None:
            continue

        post_id = str(mensaje.id)
        revisados += 1

        if post_id in registrados:
            registro = registrados[post_id]
            id_registro = registro["id"]
            if registro["id_channel_services"] != id_channel_services:
                sincronizar_id_channel_services(id_registro, id_channel_services)
                registro["id_channel_services"] = id_channel_services
        else:
            id_registro = upsert_post_y_obtener_id(channel_id, id_channel_services, post_id, today)
            registrados[post_id] = {"id": id_registro, "id_channel_services": id_channel_services}
            nuevos += 1
            print(f"🆕 Nuevo post registrado: post_id={post_id} → id_registro={id_registro}")

        insights_payload.append({
            "id_registro": id_registro,
            "fecha": today,
            "vistas": mensaje.views,
            "share": mensaje.forwards or 0,
        })

    print(f"✅ {nombre}: {revisados} posts revisados, {nuevos} nuevos")
    await asyncio.sleep(2)


async def main():
    today = get_today_utc()
    print(f"📅 Fecha del reporte: {today}\n")

    await client.start()

    print("📡 Buscando channels de Telegram (red_social=1) en community-channels...")
    channels = get_telegram_channels()
    print(f"✅ {len(channels)} channels encontrados")

    print("🔗 Buscando servicios activos (channel_services)...")
    channel_services_map = get_channel_services_map(today)
    print(f"✅ {len(channel_services_map)} channels con servicio activo asignado")

    insights_payload = []

    for channel in channels:
        id_channel_services = channel_services_map.get(channel["id"])
        if id_channel_services is None:
            print(f"⏭️  {channel['nombre']} (id={channel['id']}) sin servicio activo, omitiendo")
            continue
        await procesar_channel(channel, today, id_channel_services, insights_payload)

    if insights_payload:
        print(f"\n🚀 Insertando {len(insights_payload)} registros en insights_acumulado_post_channel_telegram...")
        result = supabase.table("insights_acumulado_post_channel_telegram") \
            .insert(insights_payload) \
            .execute()
        print(f"✅ Inserción completada: {len(result.data)} filas")
    else:
        print("⚠️ No hay estadisticas de posts para insertar")

    supabase.table("system_logs").insert({
        "clasificacion": 1,
        "modulo": 1,
        "descripcion": "Reporte diario de publicaciones Telegram channels (vistas y shares)",
        "fecha": today,
    }).execute()
    print("📝 Log registrado en system_logs")

    await client.disconnect()
    print("\n🎉 Reporte diario de Telegram completado")


if __name__ == "__main__":
    asyncio.run(main())
