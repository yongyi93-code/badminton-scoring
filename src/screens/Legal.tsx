import { useState } from 'react'
import { useLang, useT } from '@/lib/i18n'
import { useNav } from '@/store/useNav'
import { Body, Screen, Segmented, SectionTitle, TopBar } from '@/components/ui'
import { CONTACT_EMAIL, LEGAL_UPDATED, PRIVACY, TERMS, type Doc } from '@/lib/legal'

/* ------------------------------------------------------------------ *
 * 隐私政策 / 服务条款
 *
 * 两份摆在一个屏里用 Segmented 切，不是两个入口 —— 会去看其中一份
 * 的人多半两份都想看一眼，分成两处只是让他多回退一次。
 *
 * 内容在 lib/legal.ts，这里只管画。加一节、改一句都去那边改，
 * 这个文件不该再动。
 * ------------------------------------------------------------------ */

/** 只认一种记号：**加粗**。够用，而且不用为两份文档引一个 markdown 库 */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i} className="text-ink-900 font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function DocView({ doc }: { doc: Doc }) {
  const { lang } = useLang()
  const zh = lang === 'zh'
  return (
    <>
      {doc.sections.map((s) => {
        const lines = (zh ? s.zh : s.en).filter(Boolean)
        return (
          <div key={s.zhTitle}>
            <SectionTitle>{zh ? s.zhTitle : s.enTitle}</SectionTitle>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <p key={i} className="text-ink-700 text-body">
                  <Rich text={line} />
                </p>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

export function Legal({ tab = 'privacy' }: { tab?: 'privacy' | 'terms' }) {
  const t = useT()
  const back = useNav((s) => s.back)
  const [which, setWhich] = useState<'privacy' | 'terms'>(tab)
  const doc = which === 'privacy' ? PRIVACY : TERMS
  const { lang } = useLang()

  return (
    <Screen>
      <TopBar
        title={lang === 'zh' ? doc.zhTitle : doc.enTitle}
        subtitle={t(`最后更新 ${LEGAL_UPDATED}`, `Last updated ${LEGAL_UPDATED}`)}
        onBack={back}
      />
      <Body>
        <Segmented
          value={which}
          onChange={setWhich}
          options={[
            { value: 'privacy', label: t('隐私政策', 'Privacy') },
            { value: 'terms', label: t('服务条款', 'Terms') },
          ]}
        />

        <DocView doc={doc} />

        <div className="border-line mt-2 border-t pt-4 pb-2">
          <p className="text-ink-500 text-caption">
            {t(
              '要查看、更正或删除自己的数据，写信到：',
              'To see, correct or delete your data, write to:',
            )}
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-brand-600 mt-1 block text-body underline underline-offset-4"
          >
            {CONTACT_EMAIL}
          </a>
        </div>
      </Body>
    </Screen>
  )
}
