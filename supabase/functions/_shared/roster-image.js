/** Render name colors as pixels: Discord embeds cannot color individual text spans. */
export async function renderRosterImage(model) {
  const [{ ImageResponse }, React] = await Promise.all([
    import('npm:@vercel/og@0.8.6'),
    import('npm:react@19.2.8'),
  ])
  const h = React.createElement
  const colors = { blue: '#80c8ff', yellow: '#ffd45a', default: '#f2f3f5' }
  const sections = model.sections.filter(({ members }) => members.length)
  const iconIds = [
    ...new Set(sections.flatMap(({ members }) => members.map((member) => member.emojiId)).filter(Boolean)),
  ]
  const icons = new Map(
    await Promise.all(
      iconIds.map(async (id) => {
        try {
          const response = await fetch(`https://cdn.discordapp.com/emojis/${id}.png?size=40`, {
            signal: AbortSignal.timeout(3000),
          })
          if (!response.ok) return [id, null]
          const bytes = new Uint8Array(await response.arrayBuffer())
          return [
            id,
            `data:image/png;base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`,
          ]
        } catch {
          return [id, null]
        }
      }),
    ),
  )
  const height = Math.min(
    5000,
    88 + sections.reduce((total, section) => total + 40 + section.members.length * 42, 0),
  )
  const content = h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '28px 36px',
        background: '#202127',
        color: '#f2f3f5',
        fontFamily: 'sans-serif',
      },
    },
    h('div', { style: { display: 'flex', fontSize: 28, fontWeight: 700, marginBottom: 14 } }, model.title),
    ...sections.map((section, sectionIndex) =>
      h(
        'div',
        { key: sectionIndex, style: { display: 'flex', flexDirection: 'column', marginBottom: 10 } },
        h(
          'div',
          { style: { display: 'flex', color: '#aaaeb7', fontSize: 18, fontWeight: 700, marginBottom: 7 } },
          section.title,
        ),
        ...section.members.map((member, memberIndex) =>
          h(
            'div',
            {
              key: memberIndex,
              style: { display: 'flex', alignItems: 'center', height: 42, fontSize: 21 },
            },
            h(
              'div',
              { style: { display: 'flex', width: 38, color: '#9296a0', fontSize: 17 } },
              `${memberIndex + 1}.`,
            ),
            icons.get(member.emojiId)
              ? h('img', {
                  src: icons.get(member.emojiId),
                  width: 26,
                  height: 26,
                  style: { marginRight: 9 },
                })
              : null,
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  color: colors[member.color] ?? colors.default,
                  fontWeight: member.color === 'default' ? 500 : 700,
                },
              },
              member.text,
            ),
          ),
        ),
      ),
    ),
  )
  const response = new ImageResponse(content, { width: 900, height })
  if (!response.ok) throw new Error('Could not render the colored roster image.')
  return new Uint8Array(await response.arrayBuffer())
}
