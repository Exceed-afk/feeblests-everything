# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added CHANGELOG file for version tracking

### Fixed
- Fixed floating-point rounding in fmtPnl using round8
- Fixed fmtAmount to strip sign for consistent locale formatting
- Fixed rate30 null display showing '0% scheduled' when due===0
- Fixed toggleId to always return a new array (not mutate reference)
- Fixed computeHabitStats to use round8 for rate30 percentage

### Changed
- Reorganized review prompts order with documentation
- Improved PnlChart to handle zero trades case
- Enhanced HabitEditor UI for rate30 display

## [0.1.0] - 2026-10-30

### Added
- Initial project setup