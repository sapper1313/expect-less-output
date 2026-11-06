import { PageHeader } from '../ui'
import { COPY } from '@shared/copy'
import { StudioFinancialCards } from './StudioSettings'
import { StudioSpend } from './StudioSpend'

/** Everything about money: the spend caps, the generate settings and what has been spent. */
export function Financial() {
  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.financial} />
      <div className="max-w-4xl space-y-6 px-8">
        <StudioFinancialCards />
        <StudioSpend />
      </div>
    </div>
  )
}
