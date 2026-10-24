import XCTest

final class ClubNavigationUITests: XCTestCase {
    func testFivePersistentTabsAndBackToReception() {
        let app = XCUIApplication()
        app.launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        for title in ["Reception", "Daily Checks", "Members", "Shop", "More", "Reception"] {
            let tab = bar.buttons[title]
            XCTAssertTrue(tab.exists, title)
            tab.tap()
            XCTAssertTrue(tab.isSelected, title)
            XCTAssertEqual(app.tabBars.count, 1)
        }
        XCTAssertFalse(bar.buttons["Inductions"].exists)
        XCTAssertFalse(bar.buttons["Overview"].exists)
    }

    func testExistingReviewerMemberProfileBack() throws {
        let app = XCUIApplication(); app.launch()
        let demo = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "synthetic examples")).firstMatch
        guard demo.waitForExistence(timeout: 20) else { throw XCTSkip("Confirmed reviewer demonstration not present; no member record opened.") }
        let members = app.tabBars.buttons["Members"]
        XCTAssertTrue(members.waitForExistence(timeout: 20)); members.tap()
        let member = app.webViews.links.containing(.staticText, identifier: "Alex Morgan").firstMatch
        guard member.waitForExistence(timeout: 20) else { throw XCTSkip("Existing authenticated reviewer session unavailable; no credentials or records changed.") }
        member.tap()
        let readOnly = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "synthetic record cannot be edited")).firstMatch
        XCTAssertTrue(readOnly.waitForExistence(timeout: 20)); XCTAssertTrue(members.isSelected)
        app.buttons["Go back"].tap()
        XCTAssertTrue(member.waitForExistence(timeout: 20)); XCTAssertTrue(members.isSelected)
    }
    func testExistingWebMenuSynchronisesDailyChecksTab() throws {
        let app = XCUIApplication(); app.launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        let demo = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "synthetic examples")).firstMatch
        guard demo.waitForExistence(timeout: 20) else { throw XCTSkip("Confirmed reviewer demonstration not present; no web menu opened.") }
        let menu = app.webViews.buttons["Menu"].firstMatch
        guard menu.waitForExistence(timeout: 20) else { throw XCTSkip("Existing authenticated Club workspace unavailable; no login attempted.") }
        menu.tap()
        let checks = app.webViews.links["Daily checks"].firstMatch
        XCTAssertTrue(checks.waitForExistence(timeout: 10)); checks.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == YES"), object: bar.buttons["Daily Checks"])
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 10), .completed)
    }
}
