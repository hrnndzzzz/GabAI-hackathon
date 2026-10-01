import { Fragment } from 'react'
import { parseBlocks, parseInline } from '../lib/markdown'

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((t, i) =>
        t.kind === 'bold' ? (
          <strong key={i} className="font-bold">
            {t.value}
          </strong>
        ) : t.kind === 'italic' ? (
          <em key={i}>{t.value}</em>
        ) : (
          <Fragment key={i}>{t.value}</Fragment>
        ),
      )}
    </>
  )
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed">
      {parseBlocks(source).map((b, i) => {
        if (b.type === 'p')
          return (
            <p key={i}>
              <Inline text={b.text} />
            </p>
          )
        if (b.type === 'note')
          return (
            <p key={i} className="rounded-lg border-2 border-ink bg-mint/25 px-3 py-2 text-[13px]">
              <Inline text={b.text} />
            </p>
          )
        const List = b.type === 'ul' ? 'ul' : 'ol'
        return (
          <List key={i} className={b.type === 'ul' ? 'list-disc space-y-1 pl-5' : 'list-decimal space-y-1.5 pl-5'}>
            {b.items.map((item, j) => (
              <li key={j} className="pl-0.5 marker:font-mono marker:text-[12px] marker:font-bold">
                <Inline text={item.text} />
                {item.sub.map((s, k) => (
                  <span key={k} className="mt-0.5 block font-mono text-[11.5px] text-subtle">
                    <Inline text={s} />
                  </span>
                ))}
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}
