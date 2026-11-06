# Calculator Testing Guide

A hands-on checklist for testing every module, written for someone who doesn't use calculators much. Every item has an input and the answer you should get, so you don't need to know the math yourself.

---

## How to use this guide

**1. Use your own calculator's syntax.** The inputs below are written in plain form (`sin(30)`, `5!`, `sqrt(16)`). If your calculator spells something differently, use its spelling. What matters is the expected result.

**2. Cross-check anything you are unsure of with an independent source:**
- Windows Calculator (Scientific or Programmer mode)
- Google search bar (type the expression)
- Wolfram Alpha (for calculus, matrices, and statistics)
- Desmos (for graphs)
- A spreadsheet such as Excel or Google Sheets (for finance and statistics: `PMT`, `FV`, `NPV`, `IRR`, `STDEV`)

**3. Rounding is not a bug.** If the last digit or two differ (`0.7071067812` vs `0.70710678118`), that's fine. A different first few digits is a bug.

**4. Log every result.** Copy the table at the bottom, mark each item Pass or Fail, and note the exact input, expected result, actual result, and your settings (angle mode, precision, output format) for each failure. Failures with that information are easy for your agent to fix.

**5. Test order.** Start with Core, then Scientific, Finance, Conversions and Currency. Those are the ones you'll use most. Then do the rest.

### What counts as a serious failure
- A **wrong answer shown with confidence** (worse than an error message)
- `NaN`, `Infinity`, `undefined`, or `[object Object]` shown to the user
- The app crashing, freezing, or going blank
- Results changing after restarting the app
- Money amounts drifting by a cent
- Something that works in one mode but silently uses the wrong angle mode or format

### Ambiguous cases to decide on once
Some inputs have more than one valid answer. Decide which convention you want, then check that the calculator uses it consistently and the help text states it.

| Case | Common conventions |
|---|---|
| `2^3^2` | 512 (right to left, standard in math) or 64 (left to right, as in Excel) |
| `-2^2` | -4 (standard math) or 4 |
| `mod(-7, 3)` | 2 (always positive) or -1 (sign follows the first number) |
| `round(2.5)` | 3 (half up) or 2 (banker's rounding) |
| Quartiles | Several methods exist, so small differences from other tools are normal |
| Percent | `200 * 50%` should be 100. `200 + 10%` may mean 220 on some calculators, so check what yours does |

---

## 1. Core engine

### Arithmetic and order of operations

| Input | Expected |
|---|---|
| `2 + 3 * 4` | 14 |
| `(2 + 3) * 4` | 20 |
| `10 - 4 - 3` | 3 |
| `100 / 4 / 5` | 5 |
| `2^10` | 1024 |
| `2^0.5` | 1.41421356... |
| `(-2)^2` | 4 |
| `-2^2` | -4 (see ambiguous cases) |
| `2(3 + 4)` | 14 (implicit multiplication) |
| `((1+2)*(3+4))/7` | 3 |
| `200 * 50%` | 100 |
| `50%` alone | 0.5 |

### Exactness (important for money)

| Input | Expected |
|---|---|
| `0.1 + 0.2` | 0.3 (not 0.30000000000000004) |
| `0.1 * 3` | 0.3 |
| `1 / 3` | 0.333333... |
| `1 / 3` in fraction format | 1/3 |
| `123456789 * 987654321` | 121932631112635269 (exact, not scientific notation) |
| `1 - 0.9` | 0.1 |

### Output formats
Take `1 / 8` and `1234.5678` and switch between formats.

| Format | `1 / 8` should show | `1234.5678` should show |
|---|---|---|
| Decimal | 0.125 | 1234.5678 |
| Fraction | 1/8 | 6172839/5000 or similar |
| Scientific | 1.25e-1 (or similar) | 1.2345678e3 |
| Fixed 2 places | 0.13 (or 0.12, depending on rounding mode) | 1234.57 |

### Ans, variables, memory

| Steps | Expected |
|---|---|
| `5 + 5`, then `Ans * 2` | 20 |
| Set `x = 5`, then `x * 2` | 10 |
| Change `x = 7`, then `x * 2` | 14 |
| Store 42 in memory, clear the display, recall | 42 |
| Memory add and subtract (`M+`, `M-`) | Values accumulate correctly |
| Clear memory, then recall | 0 or empty (not an error or old value) |
| Use an undefined variable `y + 1` | Clear error, not a crash |

### Error handling
Each of these should give a **clear message** and leave the calculator usable.

| Input | Expected |
|---|---|
| `10 / 0` | Error (division by zero), not Infinity |
| `0 / 0` | Error or undefined |
| `2 +` | Syntax error |
| `(2 + 3` | Missing parenthesis error |
| `2 + 3)` | Unmatched parenthesis error |
| `2..3` | Invalid number error |
| `abc` | Unknown name error |
| Empty input, then Enter | Nothing happens or a gentle message |
| `+ + +` | Syntax error |
| 5,000-character expression | Handled or politely rejected, no freeze |
| 200 levels of nested parentheses | Handled or politely rejected, no crash |
| `9^9^9` | Rejected or shown as too large, with the UI still responsive |
| `1e308 * 10` | Overflow handled cleanly |

### History
- Do five calculations. All five appear in history, newest first.
- Click a history entry. It reloads the input or result.
- Pin an entry (if available). It survives clearing.
- **Close and reopen the app.** History is still there.
- Clear history. It stays cleared after restart.
- Do 1,000 calculations. History still scrolls smoothly and the app doesn't slow down.

### Pasting and input quirks
- Paste `1,000 + 2`. See what happens. Decide whether commas are accepted or rejected, and check that it's consistent.
- Paste text with `×`, `÷`, and `−` (real minus sign). These should work or give a clear error.
- Paste text with spaces and line breaks.
- Type quickly and use backspace. Nothing should lag or drop characters.
- Use the keyboard only (no mouse). Enter calculates, Escape clears (if designed that way).

---

## 2. Scientific

**Check the angle mode before every trig test.** It should be visible on screen.

### Trig, degrees mode

| Input | Expected |
|---|---|
| `sin(30)` | 0.5 |
| `cos(60)` | 0.5 |
| `tan(45)` | 1 |
| `sin(90)` | 1 |
| `cos(90)` | 0 (a tiny value like 6e-17 is acceptable, but 0 is better) |
| `tan(90)` | Error or undefined (not a huge number) |
| `asin(0.5)` | 30 |
| `acos(0.5)` | 60 |
| `atan(1)` | 45 |
| `asin(2)` | Error (or a complex result if complex mode is on) |

### Trig, radians mode

| Input | Expected |
|---|---|
| `sin(pi / 6)` | 0.5 |
| `cos(pi)` | -1 |
| `sin(pi)` | 0 (tiny value acceptable) |
| `sin(90)` | 0.8939966636 (proves radians are being used) |
| `atan(1)` | 0.7853981634 (pi/4) |

### Trig, gradians mode

| Input | Expected |
|---|---|
| `sin(50)` | 0.7071067812 |
| `cos(100)` | 0 |

### Hyperbolic

| Input | Expected |
|---|---|
| `sinh(0)` | 0 |
| `cosh(0)` | 1 |
| `tanh(0)` | 0 |
| `sinh(1)` | 1.1752011936 |

### Logs and exponentials

| Input | Expected |
|---|---|
| `ln(e)` | 1 |
| `ln(1)` | 0 |
| `log(100)` | 2 |
| `log(1000)` | 3 |
| `log(2, 8)` (or your syntax for log base 2) | 3 |
| `exp(1)` | 2.7182818285 |
| `exp(0)` | 1 |
| `ln(0)` | Error |
| `ln(-1)` | Error, or `3.14159i` in complex mode |
| `log(-5)` | Error, or a complex result in complex mode |

### Roots and powers

| Input | Expected |
|---|---|
| `sqrt(16)` | 4 |
| `sqrt(2)` | 1.4142135624 |
| `sqrt(-4)` | Error, or `2i` in complex mode |
| `cbrt(27)` | 3 |
| `cbrt(-8)` | -2 |
| `8^(1/3)` | 2 |
| `4^-1` | 0.25 |
| `0^0` | 1 (or an error, but it should be consistent and documented) |

### Factorial, permutations, combinations, gamma

| Input | Expected |
|---|---|
| `5!` | 120 |
| `0!` | 1 |
| `20!` | 2432902008176640000 |
| `(-1)!` | Error |
| `3.5!` | 11.6317283966 (gamma function) |
| `gamma(5)` | 24 |
| `5P2` (permutations) | 20 |
| `5C2` (combinations) | 10 |
| `10C0` | 1 |
| `10C10` | 1 |
| `5C7` | 0 or an error |
| `100!` | Handled (very large number), not a crash |

### Rounding and integer tools

| Input | Expected |
|---|---|
| `abs(-7)` | 7 |
| `floor(2.7)` | 2 |
| `floor(-2.5)` | -3 |
| `ceil(2.1)` | 3 |
| `ceil(-2.5)` | -2 |
| `round(2.4)` | 2 |
| `mod(10, 3)` | 1 |
| `mod(10, 0)` | Error |
| `gcd(12, 18)` | 6 |
| `lcm(4, 6)` | 12 |
| `isprime(97)` or prime check | Yes |
| Prime factors of 360 | 2^3 * 3^2 * 5 |

### Constants

| Input | Expected |
|---|---|
| `pi` | 3.14159265358979 |
| `e` | 2.71828182845905 |
| `2 * pi` | 6.28318530717959 |

---

## 3. Statistics and probability

### Descriptive statistics
Enter this dataset: **2, 4, 4, 4, 5, 5, 7, 9**

| Measure | Expected |
|---|---|
| Count | 8 |
| Sum | 40 |
| Mean | 5 |
| Median | 4.5 |
| Mode | 4 |
| Minimum / Maximum | 2 / 9 |
| Range | 7 |
| Population variance | 4 |
| Population standard deviation | 2 |
| Sample variance | 4.5714 |
| Sample standard deviation | 2.1381 |
| Q1 / Q3 | 4 / 6 (other methods may differ slightly) |

Make sure the screen clearly says whether it's **sample** or **population**. Mixing them up is the most common stats bug.

### Edge cases for datasets
- Empty dataset: a clear message, no crash.
- One value (`5`): mean 5, sample standard deviation undefined (an error or "n/a"), not 0 and not a crash.
- All the same values (`3, 3, 3, 3`): standard deviation 0.
- Negative numbers and decimals (`-1.5, 2.25, 0`): works.
- Text in the data (`2, abc, 4`): rejected or skipped with a visible warning.
- Pasting from a spreadsheet column: works.
- Importing a CSV: works. A bad CSV gives a clear error.
- 10,000 values: stays responsive.
- Change one value: all statistics update.

### Regression

**Linear:** points (1,2), (2,3), (3,5), (4,4), (5,6)

| Measure | Expected |
|---|---|
| Slope | 0.9 |
| Intercept | 1.3 |
| r | 0.9 |
| R squared | 0.81 |

**Perfect line:** (1,2), (2,4), (3,6), (4,8) gives `y = 2x`, r = 1.

**Quadratic:** (0,1), (1,2), (2,5), (3,10) gives `y = x^2 + 1` (a = 1, b = 0, c = 1).

**Exponential:** (0,1), (1,2), (2,4), (3,8) gives a = 1 and b = 0.6931 in the form `y = a * e^(b*x)`, or a = 1 and b = 2 in the form `y = a * b^x`. Check which form is displayed.

**Edge cases:** all x values the same (vertical line) gives a clear error. Only one point gives an error. Two points gives an exact line.

### Distributions

| Test | Expected |
|---|---|
| Normal CDF at 0 (mean 0, SD 1) | 0.5 |
| Normal CDF at 1 | 0.8413 |
| Normal CDF at 1.96 | 0.9750 |
| Normal inverse CDF at 0.975 | 1.9600 |
| Normal with mean 100, SD 15: CDF at 115 | 0.8413 |
| Binomial (n=10, p=0.5): chance of exactly 5 | 0.2461 |
| Binomial (n=10, p=0.5): chance of 5 or fewer | 0.6230 |
| Poisson (lambda=3): chance of exactly 2 | 0.2240 |
| Poisson (lambda=3): chance of exactly 0 | 0.0498 |
| t distribution CDF at 0 | 0.5 |
| t critical value, 95% two-sided, df = 10 | 2.228 |
| Chi-square critical value, 95%, df = 1 | 3.841 |
| Chi-square critical value, 95%, df = 2 | 5.991 |
| Uniform (0 to 10): chance of being below 2.5 | 0.25 |

Invalid inputs should produce clear errors: probability of 1.5, negative standard deviation, n = -3, p = 2, k larger than n.

### Confidence intervals and tests
- z interval: sample mean 50, known SD 10, n = 25, 95% confidence gives **46.08 to 53.92**.
- Make the confidence level 99%. The interval gets wider.
- Make n larger. The interval gets narrower.

### Charts
- Histogram: bars match the data counts (for the dataset above, the value 4 has the tallest bar with 3 items).
- Scatter plot with regression line: the line passes through the middle of the points.
- Box plot: median line matches the median you calculated.
- Empty and single-value data don't crash the charts.

---

## 4. Finance

Money math must be **exact to the cent**. Compare every result against a spreadsheet.

### Loans and mortgages

| Scenario | Expected |
|---|---|
| $200,000 at 6% yearly, 30 years, monthly payments | Payment **$1,199.10** |
| Same loan, total interest | About **$231,676** |
| Same loan, first month interest | $1,000.00 |
| Same loan, first month principal | $199.10 |
| $100,000 at 5%, 15 years, monthly | Payment **$790.79** |
| Any loan, 0% interest | Payment = amount divided by number of payments |

**Amortization schedule checks (use the $200,000 loan):**
- Number of rows is 360.
- Every row: payment = interest + principal.
- Interest column goes down and principal column goes up over time.
- Last balance is exactly 0.00.
- Total principal paid is exactly $200,000.00.
- Add an extra $200 a month. The loan finishes earlier and total interest drops.

### Compound and simple interest
$1,000 at 5% for 10 years:

| Type | Expected |
|---|---|
| Compounded yearly | $1,628.89 |
| Compounded monthly | $1,647.01 |
| Compounded daily | $1,648.66 |
| Continuous | $1,648.72 |
| Simple interest | $1,500.00 |

### Time value of money (solve for each unknown)
- Present value $1,000, 5% a year, 10 years: future value **$1,628.89**.
- Future value $1,628.89, 5%, 10 years: present value **$1,000.00**.
- Present value $1,000, future value $1,628.89, 10 years: rate **5.00%**.
- Present value $1,000, future value $1,628.89, 5%: periods **10**.
- Saving $500 a month at 6% a year (paid monthly, end of month) for 10 years: future value about **$81,939.67**.

### NPV, IRR, and payback
Cash flows: **-1000, 400, 400, 400**

| Measure | Expected |
|---|---|
| NPV at 10% | -5.26 |
| IRR | About 9.70% |
| Payback period | 2.5 years |

Edge cases: all positive cash flows (IRR undefined, with a clear message), all negative cash flows, a single cash flow.

### Percentage tools

| Scenario | Expected |
|---|---|
| Percent change from 80 to 100 | +25% |
| Percent change from 100 to 80 | -20% |
| $80 with 25% discount | $60 |
| $100 plus 8% tax | $108 |
| 20% tip on $50 | $10 |
| Cost $60, price $100: margin | 40% |
| Cost $60, price $100: markup | 66.67% |
| Markup of 50% on cost $50 | Price $75 |

### Trading tools (gold, XAUUSD)
Check which contract size your calculator assumes. The standard is 1 lot = 100 oz, so a $1 move per lot is $100. Your broker may differ.

| Scenario | Expected |
|---|---|
| Account $10,000, risk 1% | Risk amount $100 |
| Risk $100, stop distance $10, 100 oz per lot | **0.10 lots** |
| Entry 2000, stop 1990, target 2030 | Reward to risk **3 : 1** |
| Break-even win rate at 3 : 1 | **25%** |
| Entry 2000, stop 2000 (zero stop distance) | Clear error, not a crash or infinite size |
| Risk 0% | Position size 0 or a clear message |

Also try: a short trade (stop above entry), a very tight stop, and a risk above 100% (should warn).

### Edge cases for all finance
- Interest rate of 0%, a negative rate, 100%, and 1,000%.
- Zero or negative number of periods.
- Very large amounts (1 billion) with no rounding drift.
- Rounding: the schedule's total matches the stated payment times the number of payments (the last payment can adjust by a few cents).
- Result displays use two decimals for money and don't show 1,199.1000000001.

---

## 5. Conversions and currency

### Unit conversions

| Conversion | Expected |
|---|---|
| 1 km to miles | 0.621371 |
| 1 mile to km | 1.609344 |
| 1 inch to cm | 2.54 |
| 1 foot to cm | 30.48 |
| 1 kg to pounds | 2.204623 |
| 1 pound to grams | 453.59237 |
| 1 US gallon to liters | 3.785412 |
| 1 liter to ml | 1000 |
| 100 °C to °F | 212 |
| 0 °C to °F | 32 |
| -40 °C to °F | -40 |
| 0 K to °C | -273.15 |
| 1 hour to seconds | 3600 |
| 1 day to hours | 24 |
| 1 GB to MB | 1000 (decimal) or 1024 (binary). Check which it states, and whether GiB is separate |
| 60 mph to km/h | 96.56064 |

**Round trip test:** convert a value to another unit and back. You should get the original value (within rounding). Try 5 different unit pairs.

**Other checks:** converting between incompatible units (kg to meters) gives a clear error. Zero and negative values work (except where they make no sense). Very large and very small values work.

### Currency with manual rates
Set up: base currency **USD**, EUR = **0.92**, GBP = **0.79** (meaning 1 USD = 0.92 EUR).

| Test | Expected |
|---|---|
| 100 USD to EUR | 92 |
| 92 EUR to USD | 100 |
| 100 EUR to GBP (through the base) | 85.87 (85.8696) |
| 100 USD to USD | 100 |
| 100 USD to JPY with no JPY rate | Clear "rate missing" message with a way to add it, not a guess |
| Change EUR to 0.90, convert 100 USD | 90 |
| Add a custom code (for example XAU) | Accepted |
| Rate of 0, negative, or text | Rejected with a message |
| Rate with many decimals (0.000123456789) | Stored exactly, not rounded |
| Type `100 USD to EUR` in the expression bar (if supported) | 92 |

**Behavior checks:**
- Inverse rate: set EUR 0.92, then check that EUR to USD uses 1 / 0.92 automatically.
- Direct pair override: set a direct EUR to GBP rate of 0.86. It should be used instead of the cross rate.
- Last-updated date shows on each rate.
- Stale warning: set the threshold to 1 day, then change a rate's date to 3 days ago (or wait). It should be marked stale.
- History snapshot: convert 100 USD to EUR, change the EUR rate, then look at the old history entry. It should still show the old rate it used.
- Rate sets (if built): create a second set with different rates and switch. Results follow the active set.
- Import and export: export rates, delete them, import the file. Everything returns.
- Bad import file (wrong columns, text where numbers belong) gives a clear error and doesn't overwrite good data.
- **Restart the app.** Rates and settings are still there.
- Offline: disconnect from the internet and confirm everything works the same.

### Number bases

| Input | Expected |
|---|---|
| 255 in hex | FF |
| 255 in binary | 11111111 |
| 255 in octal | 377 |
| `0xFF` | 255 |
| `0b1010` | 10 |
| Binary 1010 to decimal | 10 |
| Hex `ff` (lowercase) | 255 |
| Hex `GG` | Error |
| Binary `102` | Error |
| 0 in any base | 0 |
| -10 in binary | Shown clearly (as -1010 or two's complement, depending on mode) |

---

## 6. Graphing

### Basic shapes

| Function | You should see |
|---|---|
| `y = x` | Straight diagonal line through the origin |
| `y = x^2` | U-shaped parabola, lowest point at the origin |
| `y = x^3` | S-shaped curve through the origin |
| `y = sin(x)` | Smooth wave, height between -1 and 1, repeating every 6.28 (2 pi) in radians |
| `y = abs(x)` | V shape |
| `y = 1/x` | Two separate curves, with **no line connecting them across x = 0** |
| `y = sqrt(x)` | Only on the right side, starting at 0 |
| `y = ln(x)` | Only for x above 0, going down steeply near 0 |
| `y = tan(x)` | Repeating curves with **no vertical lines drawn across the gaps** |
| `y = 5` | Flat horizontal line |

### Trace and table
- Trace `y = x^2` at x = 2. It should show y = 4.
- Table for `y = x^2`, x from 0 to 5: 0, 1, 4, 9, 16, 25.
- Table with a step of 0.5 gives the right intermediate values.

### Finders

| Function | Expected |
|---|---|
| Roots of `y = x^2 - 4` | x = -2 and x = 2 |
| Minimum of `y = x^2 - 4` | (0, -4) |
| Roots of `y = x^3 - 3x` | -1.732, 0, 1.732 |
| Local maximum of `y = x^3 - 3x` | (-1, 2) |
| Local minimum of `y = x^3 - 3x` | (1, -2) |
| Intersection of `y = x` and `y = x^2` | (0, 0) and (1, 1) |
| Intersection of `y = x` and `y = x + 1` | None (parallel lines), with a clear message |
| Derivative of `y = x^2` at x = 3 | 6 |
| Root of `y = x^2 + 1` | None, with a clear message |

### Other plot types
- **Parametric:** `x = cos(t)`, `y = sin(t)`, t from 0 to 6.28, gives a circle of radius 1.
- **Polar:** `r = 1` gives a circle. `r = 1 + cos(theta)` gives a heart-like shape (cardioid). `r = theta` gives a spiral.
- **Multiple functions:** plot three at once, each in a different color. Toggle each on and off.
- **Inequality or implicit plots (if built):** `y > x` shades above the line.

### Controls
- Zoom in and out with mouse wheel and buttons. The curve stays smooth.
- Pan by dragging. No lag.
- Reset view returns to the default.
- Auto-scale fits the function.
- Zoom in extremely far (very small range) and out extremely far. No crash or blank screen.
- Resize the window. The graph redraws properly.
- Dark and light theme: the graph and axes are readable.

### Edge cases
- Invalid function (`y = x +`): error message, graph stays usable.
- `y = x^1000`, `y = 1/(x-1)`, `y = sin(1/x)` near 0: no freeze and no false lines.
- Many functions at once (10): still smooth.
- Angle mode: in degree mode, `y = sin(x)` should repeat every 360. Check that it matches the stated mode.

---

## 7. Linear algebra and complex numbers

### Matrices
Use **A = [[1, 2], [3, 4]]**

| Operation | Expected |
|---|---|
| Determinant | -2 |
| Transpose | [[1, 3], [2, 4]] |
| Inverse | [[-2, 1], [1.5, -0.5]] |
| A times A | [[7, 10], [15, 22]] |
| A plus A | [[2, 4], [6, 8]] |
| 2 times A | [[2, 4], [6, 8]] |
| Rank | 2 |
| A times its inverse | Identity [[1, 0], [0, 1]] (tiny rounding like 1e-16 is fine) |

**Singular matrix [[1, 2], [2, 4]]:** determinant 0, rank 1, inverse gives a clear "not invertible" error.

**Dimension errors:** multiplying a 2x3 matrix by another 2x3 matrix gives a clear dimension error. Adding matrices of different sizes gives an error.

**Eigenvalues:**

| Matrix | Expected eigenvalues |
|---|---|
| [[2, 0], [0, 3]] | 2 and 3 |
| [[2, 1], [1, 2]] | 3 and 1 (eigenvectors proportional to (1, 1) and (1, -1)) |
| [[0, -1], [1, 0]] | i and -i (complex) |

**Solving systems:**
- `x + y = 3` and `x - y = 1` gives x = 2, y = 1.
- `2x + 3y = 8` and `x - y = -1` gives x = 1, y = 2.
- Parallel equations (`x + y = 1` and `x + y = 2`) give "no solution".
- Duplicate equations give "infinitely many solutions".

**Other checks:** a 1x1 matrix works. A larger matrix (5x5 or 10x10) stays responsive. Row reduction of [[1, 2], [3, 4]] ends in the identity.

### Vectors

| Operation | Expected |
|---|---|
| (1, 2, 3) dot (4, 5, 6) | 32 |
| (1, 2, 3) cross (4, 5, 6) | (-3, 6, -3) |
| Length of (3, 4) | 5 |
| Angle between (1, 0) and (0, 1) | 90 degrees |
| Cross product of 2D vectors | Error or a clear rule |
| Dot product with mismatched lengths | Error |

### Complex numbers

| Input | Expected |
|---|---|
| `(3 + 4i) + (1 - 2i)` | 4 + 2i |
| `(3 + 4i) * (1 - 2i)` | 11 - 2i |
| `(3 + 4i) / (1 - 2i)` | -1 + 2i |
| `i * i` | -1 |
| `abs(3 + 4i)` | 5 |
| Conjugate of `3 + 4i` | 3 - 4i |
| `sqrt(-1)` | i |
| `1 + i` in polar form | 1.4142 at angle 45 degrees (0.7854 rad) |
| `exp(i * pi)` | -1 (a tiny imaginary part like 1e-16 is fine, but displaying it as `-1 + 1.22e-16i` is untidy) |
| Cube roots of 8 | 2, -1 + 1.732i, -1 - 1.732i |

### Polynomial roots

| Polynomial | Expected roots |
|---|---|
| `x^2 - 5x + 6` | 2, 3 |
| `x^2 + 1` | i, -i |
| `x^3 - 6x^2 + 11x - 6` | 1, 2, 3 |
| `x^2 + 2x + 1` | -1 (double root) |

---

## 8. Symbolic math (CAS)

**The rule for this module: a wrong answer is far worse than "could not solve".** Check each answer, and if you're unsure, differentiate or substitute back.

### Simplify, expand, factor

| Input | Expected |
|---|---|
| Simplify `(x^2 - 1)/(x - 1)` | `x + 1` |
| Expand `(x + 1)^2` | `x^2 + 2x + 1` |
| Expand `(x + 2)(x - 3)` | `x^2 - x - 6` |
| Factor `x^2 - 5x + 6` | `(x - 2)(x - 3)` |
| Factor `x^2 - 1` | `(x - 1)(x + 1)` |
| Factor `x^2 + 1` | Stays as is (or `(x - i)(x + i)` in complex mode) |
| Substitute x = 3 into `x^2 + 1` | 10 |

### Solving

| Input | Expected |
|---|---|
| Solve `2x + 3 = 7` | x = 2 |
| Solve `x^2 - 4 = 0` | x = 2 and x = -2 |
| Solve `x^2 + 1 = 0` | x = i and x = -i (or "no real solutions") |
| Solve `x^2 - 5x + 6 = 0` | x = 2 and x = 3 |
| Solve `x + y = 3` and `x - y = 1` | x = 2, y = 1 |
| Solve `x = x + 1` | No solution |
| Solve `x = x` | All values |

### Derivatives

| Function | Expected derivative |
|---|---|
| `x^3` | `3x^2` |
| `sin(x)` | `cos(x)` |
| `cos(x)` | `-sin(x)` |
| `e^(2x)` | `2e^(2x)` |
| `ln(x)` | `1/x` |
| `x * sin(x)` | `sin(x) + x*cos(x)` |
| `5` (a constant) | 0 |

### Integrals

| Integral | Expected |
|---|---|
| Indefinite of `x^2` | `x^3/3` (plus C) |
| Indefinite of `sin(x)` | `-cos(x)` |
| Indefinite of `1/x` | `ln(x)` or `ln(abs(x))` |
| Definite of `x^2` from 0 to 1 | 1/3 (0.3333) |
| Definite of `sin(x)` from 0 to pi | 2 |
| Definite of `1` from 0 to 5 | 5 |

**Self-check:** differentiate each integral result. You should get back the original function.

### Limits and series

| Limit | Expected |
|---|---|
| `sin(x)/x` as x approaches 0 | 1 |
| `1/x` as x approaches infinity | 0 |
| `(1 - cos(x))/x^2` as x approaches 0 | 1/2 |
| `(1 + 1/x)^x` as x approaches infinity | e |
| `1/x` as x approaches 0 | Does not exist (or shows left and right limits differ) |

Taylor series of `e^x` around 0: `1 + x + x^2/2 + x^3/6 + ...`

### Limits of the engine (these should fail safely)
- A hard integral such as `e^(x^2)` should give a special-function answer (erf) or "could not solve", **not a wrong answer**.
- A very large expression or something that takes a long time should **stop by itself** after the time limit with a clear message, and the app stays responsive.
- Running a heavy CAS problem while using the rest of the app: the rest of the app doesn't freeze.
- Rendered math looks right (fractions, exponents, square roots) and can be copied.

---

## 9. Programming and number tools

### Bitwise

| Input | Expected |
|---|---|
| `12 AND 10` | 8 |
| `12 OR 10` | 14 |
| `12 XOR 10` | 6 |
| `NOT 12` | -13 (signed) |
| `1 << 4` | 16 |
| `256 >> 2` | 64 |
| `-8 >> 1` | -4 (arithmetic shift) |
| 8-bit two's complement of -1 | 11111111 |
| `0 AND anything` | 0 |
| Bitwise with decimals (`2.5 AND 1`) | Error |

### Custom functions
- Define `f(x) = x^2 + 1`, then `f(3)` gives 10.
- Define a function that uses another function (`g(x) = f(x) * 2`), then `g(3)` gives 20.
- Redefine `f`. Dependent results update.
- Delete `f`. Using it gives a clear "unknown function" message.
- Define a function with two inputs (`h(a, b) = a * b`), then `h(3, 4)` gives 12 and `h(3)` gives an arity error.
- Recursion without an end condition (`f(n) = n * f(n - 1)`) must stop with an error, **not hang or crash**.
- Functions persist after restarting the app.

### Scripts and saved programs

| Test | Expected |
|---|---|
| Loop adding 1 to 100 | 5050 |
| 10th Fibonacci number (1, 1, 2, 3, 5...) | 55 |
| Factorial of 6 using a loop | 720 |
| Script with a syntax error | Message that names the line |
| Endless loop (`while true`) | **Stopped by a step or time limit** with a message |
| Script trying to read files, open the network, or reach the app's internals | **Blocked** |
| Script producing huge output (a million lines) | Capped, no freeze |

- Save a program, close the app, reopen. It's still there and still runs.
- Rename and delete a program.
- Export a program to a file and import it back.
- Import a broken or malicious file. It's rejected or shown as text, never run automatically.

---

## 10. Date and time

| Test | Expected |
|---|---|
| Days between 2023-01-01 and 2024-01-01 | 365 |
| Days between 2024-01-01 and 2025-01-01 | 366 (leap year) |
| Days between 2024-01-01 and 2024-12-31 | 365 |
| 2024-02-15 plus 30 days | 2024-03-16 |
| 2024-01-31 plus 1 month | 2024-02-29 (clamped to the month's end), or consistent with a documented rule |
| 2024-02-29 plus 1 year | 2025-02-28 (or 2025-03-01, as long as the rule is stated and consistent) |
| 2024-03-31 minus 1 month | 2024-02-29 |
| Friday plus 1 business day | Following Monday |
| Monday plus 5 business days | Next Monday |
| Business days with a holiday list (if supported) | Holidays are skipped |

### Age
- Born 1990-06-15, on 2026-06-14: **35**. On 2026-06-15: **36**.
- Born 2000-02-29 (leap day), on 2024-02-28: **23**. On 2024-02-29: **24**.
- Birth date in the future: a clear error.

### Duration arithmetic

| Input | Expected |
|---|---|
| `2h 30m + 45m` | 3h 15m |
| `90m` | 1h 30m |
| `1h 45m * 2` | 3h 30m |
| `1h - 90m` | -30m (or a clear rule) |
| `24h` | 1 day (or 24h, depending on display) |

### Time zones and daylight saving
- 12:00 UTC in New York in **July**: 08:00 (UTC-4).
- 12:00 UTC in New York in **January**: 07:00 (UTC-5).
- 12:00 UTC in Tokyo: 21:00.
- 12:00 UTC in London in July: 13:00, and in January: 12:00.
- On the US daylight saving start day (2024-03-10), adding 1 hour to 01:30 New York time gives 03:30.
- Date at midnight conversions don't shift the date by mistake.

### Countdown and today
- Countdown to a date next month shows the right number of days (compare with a real calendar).
- "Today" matches your computer's date.
- Invalid dates (2024-02-30, 2024-13-01) give a clear error.
- Different date formats you may type (2024-03-05, 03/05/2024) are interpreted the way the interface states, so a day-month mix-up can't happen silently.

---

## 11. Interface and general behavior

### Settings and persistence
- Change angle mode, precision, and output format. **Restart.** Settings are remembered.
- Switch angle mode in the middle of a session. Existing history entries keep their original results.
- Reset settings (if available). Defaults return.

### Navigation and modes
- Switch between every mode (Basic, Scientific, Statistics, Finance, Graph, Matrix, CAS, Convert, Programming, Date). Nothing is lost when switching back.
- Open the calculator, leave to another part of the app, return. State is kept (or intentionally reset, as designed).
- Variables defined in one mode work in others (for example `x = 5` in Basic, then `sin(x)` in Scientific).

### Help and discovery
- Function search or autocomplete finds `sin`, `loan`, `matrix`.
- Help shows an example for each function, and the example works when you run it.
- Searching for the calculator in the app's global search finds it (try `calc`, `loan`, `convert`).

### Keyboard and accessibility
- Do a whole calculation using only the keyboard.
- Tab order moves through the controls in a sensible order.
- Focus is clearly visible.
- Text stays readable at large font sizes and zoom levels.
- Contrast is good in light and dark themes.

### Copy and paste
- Copy a result as plain text, and as LaTeX (if offered). Paste somewhere else. It matches what you saw.
- Copying a long number doesn't add commas or hidden characters.

### Performance and stability
- Opening the calculator is quick. The rest of the app doesn't start slower than before.
- Heavy actions (big dataset, big matrix, complex graph, hard CAS) don't freeze the interface.
- Leave the calculator running for 30 minutes of mixed use. Memory use doesn't keep growing.
- Do 20 operations in a row quickly. No crash, no missed input.
- Cause an error on purpose in every mode, then do a normal calculation. The calculator recovers.
- Force-close the app in the middle of a calculation. On reopening, nothing is corrupted.

### Data safety
- Nothing is sent over the network (use your system's network monitor while using the calculator, if you want to confirm).
- Back up and restore the app's data (if you have that feature). Calculator history, programs, and rates come back.
- Update the app to a new version with existing calculator data. Nothing is lost.

---

## Results log (copy and fill in)

| # | Module | Input | Expected | Actual | Pass or Fail | Settings (angle mode, precision, format) | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Core | `2 + 3 * 4` | 14 | | | | |
| 2 | | | | | | | |

### Reporting a failure to your agent
Send the failing row from the log with this wording:

> **Module:** Finance. **Test:** 30-year mortgage payment. **Input:** $200,000, 6%, 30 years, monthly. **Expected:** $1,199.10. **Actual:** $1,199.11. **Settings:** two decimal places, normal rounding. Please find the cause, add a test that reproduces it, then fix it.

Asking for a **reproducing test first** means the bug can't quietly return later.

---

## Suggested testing plan

| Session | What to cover | Time |
|---|---|---|
| 1 | Core (arithmetic, exactness, errors, history) | 30 to 45 minutes |
| 2 | Scientific | 30 to 45 minutes |
| 3 | Finance and trading tools | 45 minutes |
| 4 | Conversions and currency | 30 to 45 minutes |
| 5 | Statistics | 45 minutes |
| 6 | Graphing | 45 minutes |
| 7 | Linear algebra, complex numbers | 30 minutes |
| 8 | CAS | 45 minutes |
| 9 | Programming and number tools | 30 minutes |
| 10 | Date and time | 30 minutes |
| 11 | Interface, persistence, and stability | 45 minutes |

After any fix from your agent, **re-run the whole module**, not just the failed item, because fixes can break neighboring features.
