import { amortize, monthlyPayment } from '../src/shared/tools-math'

for (const [rate, term] of [[12, 720], [12, 300], [20, 600], [30, 480], [6, 1200]] as const) {
    const { schedule } = amortize(1_000_000, rate, term)
    console.log(`rate ${rate}% term ${term}m -> payment ${monthlyPayment(1_000_000, rate, term)}, periods ${schedule.length}, final balance ${schedule.at(-1)!.balanceCents}`)
}
