# Calculator Functions & Constants Reference

This document is automatically generated from the calculator's centralized function registry (`src/shared/calculator/registry.ts`).

---

## Constants

| Constant | Symbol / Alias | Description | Value |
|---|---|---|---|
| `pi` | π, PI | Ratio of circumference of a circle to its diameter | `3.14159265` |
| `e` | E | Euler's number, base of natural logarithm | `2.71828183` |

---

## Functions Reference

### Core Arithmetic & Utility

| Function | Arity | Description | Examples |
|---|---|---|---|
| `abs` | 1 | Absolute value | `abs(-5)`, `abs(3.14)` |
| `sqrt` | 1 | Square root | `sqrt(16)`, `sqrt(2)` |
| `cbrt` | 1 | Cube root | `cbrt(27)`, `cbrt(-8)` |
| `round` | 1..2 | Round to nearest integer or specified decimal places | `round(3.7)`, `round(3.14159, 2)` |
| `floor` | 1 | Round down to nearest integer | `floor(3.9)`, `floor(-2.1)` |
| `ceil` | 1 | Round up to nearest integer | `ceil(3.1)`, `ceil(-2.9)` |
| `min` | 1..99 | Smallest of arguments | `min(3, 5, 1)`, `min(-2, 4)` |
| `max` | 1..99 | Largest of arguments | `max(3, 5, 1)`, `max(-2, 4)` |

### Scientific & Trigonometry

| Function | Arity | Description | Examples |
|---|---|---|---|
| `sin` | 1 | Sine of angle | `sin(90)`, `sin(pi/2)` |
| `cos` | 1 | Cosine of angle | `cos(0)`, `cos(pi)` |
| `tan` | 1 | Tangent of angle | `tan(45)`, `tan(0)` |
| `cot` | 1 | Cotangent of angle | `cot(45)`, `cot(90)` |
| `sec` | 1 | Secant of angle | `sec(0)`, `sec(60)` |
| `csc` | 1 | Cosecant of angle | `csc(90)`, `csc(30)` |
| `asin` | 1 | Inverse sine | `asin(1)`, `asin(0.5)` |
| `acos` | 1 | Inverse cosine | `acos(1)`, `acos(0)` |
| `atan` | 1 | Inverse tangent | `atan(1)`, `atan(0)` |
| `sinh` | 1 | Hyperbolic sine | `sinh(0)`, `sinh(1)` |
| `cosh` | 1 | Hyperbolic cosine | `cosh(0)`, `cosh(1)` |
| `tanh` | 1 | Hyperbolic tangent | `tanh(0)`, `tanh(1)` |
| `ln` | 1 | Natural logarithm (base e) | `ln(e)`, `ln(1)` |
| `log10` | 1 | Common logarithm (base 10) | `log10(100)`, `log10(1000)` |
| `log2` | 1 | Binary logarithm (base 2) | `log2(8)`, `log2(1024)` |
| `exp` | 1 | Exponential e^x | `exp(1)`, `exp(0)` |
| `fact` | 1 | Factorial of non-negative integer | `fact(5)`, `fact(0)` |
| `mod` | 2 | Remainder after division a mod b (sign follows a) | `mod(10, 3)`, `mod(-10, 3)` |
| `yroot` | 2 | The y-th root of x (yRoot(x, y)) | `yRoot(8, 3)`, `yRoot(16, 4)` |
| `gcd` | 2 | Greatest common divisor | `gcd(24, 36)`, `gcd(17, 13)` |
| `lcm` | 2 | Least common multiple | `lcm(4, 6)`, `lcm(12, 18)` |
| `nPr` | 2 | Permutations P(n, r) | `nPr(5, 2)`, `nPr(10, 3)` |
| `nCr` | 2 | Combinations C(n, r) | `nCr(5, 2)`, `nCr(10, 3)` |
| `isprime` | 1 | True (1) when n is a prime number, otherwise false (0) | `isprime(7)`, `isprime(60)` |
| `primefactors` | 1 | Prime factorisation of n, shown as 2 x 2 x 3 x 5 | `primefactors(60)` |

### Statistics & Probability

| Function | Arity | Description | Examples |
|---|---|---|---|
| `stats_boxplot` | 1..999 | Box plot statistics (type-7 quartiles, 1.5×IQR whiskers) as text | `stats_boxplot(2, 4, 4, 4, 5, 5, 7, 9)` |
| `stats_scatter_r2` | 4..999 | R² of the linear fit through paired x/y arguments (x1, y1, x2, y2, ...) | `stats_scatter_r2(1, 2, 2, 4, 3, 6)` |
| `stats_quadratic_r2` | 6..999 | R² of the least-squares parabola y = ax² + bx + c through paired x/y arguments (x1, y1, x2, y2, ...) | `stats_quadratic_r2(0, 1, 1, 0, 2, 3)` |
| `normal_pdf` | 1..3 | Normal distribution PDF | `normal_pdf(0, 0, 1)` |
| `normal_cdf` | 1..3 | Normal distribution CDF | `normal_cdf(1.96, 0, 1)` |
| `normal_inv` | 1..3 | Normal distribution INV | `normal_inv(0.975, 0, 1)` |
| `binomial_pdf` | 1..3 | Binomial distribution PDF | `binomial_pdf(3, 10, 0.5)` |
| `binomial_cdf` | 1..3 | Binomial distribution CDF | `binomial_pdf(3, 10, 0.5)` |
| `binomial_inv` | 3 | Binomial distribution INV | `binomial_pdf(3, 10, 0.5)` |
| `poisson_pdf` | 1..2 | Poisson distribution PDF | `poisson_pdf(2, 3)` |
| `poisson_cdf` | 1..2 | Poisson distribution CDF | `poisson_pdf(2, 3)` |
| `poisson_inv` | 2 | Poisson distribution INV | `poisson_pdf(2, 3)` |
| `t_pdf` | 1..2 | Student's t-distribution PDF | `t_cdf(1.96, 30)` |
| `t_cdf` | 1..2 | Student's t-distribution CDF | `t_cdf(1.96, 30)` |
| `t_inv` | 1..2 | Student's t-distribution INV | `t_cdf(1.96, 30)` |
| `chi2_pdf` | 1..2 | Chi-square distribution PDF | `chi2_cdf(3.84, 1)` |
| `chi2_cdf` | 1..2 | Chi-square distribution CDF | `chi2_cdf(3.84, 1)` |
| `chi2_inv` | 1..2 | Chi-square distribution INV | `chi2_cdf(3.84, 1)` |
| `uniform_pdf` | 1..3 | Uniform distribution PDF | `uniform_pdf(0.5, 0, 1)` |
| `uniform_cdf` | 1..3 | Uniform distribution CDF | `uniform_pdf(0.5, 0, 1)` |
| `uniform_inv` | 1..3 | Uniform distribution INV | `uniform_pdf(0.5, 0, 1)` |
| `mean` | 1..999 | Arithmetic mean of comma-separated values in a dataset expression | `mean(1, 2, 3, 4)` |
| `stdev` | 2..999 | Sample standard deviation | `stdev(2, 4, 4, 4, 5, 5, 7, 9)` |
| `stdevp` | 1..999 | Population standard deviation | `stdevp(2, 4, 4, 4, 5, 5, 7, 9)` |
| `median` | 1..999 | Median of values | `median(1, 3, 2)` |
| `gensigma` | 1 | Gamma function Γ(x) | `gensigma(5)` |

### Financial Calculations

| Function | Arity | Description | Examples |
|---|---|---|---|
| `pmt` | 3..4 | Loan payment per period given rate, periods, and present value | `pmt(0.005, 360, 200000)` |
| `pv` | 4..5 | Present value of an investment or loan | `pv(0.05, 5, 0, 12762.82)` |
| `fv` | 4..5 | Future value of an investment | `fv(0.05, 5, 0, -10000)` |
| `nper` | 4..5 | Number of periods for an investment or loan | `nper(0.07, 0, -1000, 2000)` |
| `npv` | 2..999 | Net present value given rate and periodic cash flows | `npv(0.10, -1000, 300, 400, 400, 300)` |
| `irr` | 2..999 | Internal rate of return for a series of cash flows | `irr(-1000, 300, 400, 400, 300)` |
| `compound` | 3..4 | Compound interest future value (principal, annualRate, years, compoundingPeriodsPerYear) | `compound(10000, 0.05, 5, 4)` |

### Linear Algebra & Complex Numbers

| Function | Arity | Description | Examples |
|---|---|---|---|
| `dot` | 2 | Dot product of two vectors represented as numbers | `dot(3, 4)` |
| `cabs` | 2 | Modulus of complex number (re, im) | `cabs(3, 4)` |

