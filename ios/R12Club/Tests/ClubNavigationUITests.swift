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
    #if DEBUG
    func testLocalSyntheticScreenshotPresentation() throws {
        let app = XCUIApplication()
        app.launchEnvironment["R12_CLUB_SCREENSHOTS"] = "1"
        app.launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts["Recent arrivals"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.navigationBars.count, 0)
        XCTAssertFalse(app.buttons["Page options"].exists)
        XCTAssertLessThan(app.webViews.firstMatch.frame.minY, 100)
        for (index, title) in ["Reception", "Daily Checks", "Members", "Shop"].enumerated() {
            bar.buttons[title].tap()
            let marker = title == "Reception" ? "Recent arrivals" : title == "Daily Checks" ? "Daily checks" : title == "Members" ? "Alex Morgan" : "Apocalypse Nutrition Shaker"
            let element = title == "Shop" ? app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch : app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: 20), title)
            XCTAssertTrue(bar.buttons[title].isSelected)
            XCTAssertFalse(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "DEMO ACCOUNT - READ ONLY")).firstMatch.exists)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "0\(index + 1)-\(title.replacingOccurrences(of: " ", with: "-"))"
            shot.lifetime = .keepAlways; add(shot)
        }
        bar.buttons["More"].tap()
        XCTAssertTrue(app.webViews.links["Glow Zone"].waitForExistence(timeout: 10))
        XCTAssertTrue(bar.buttons["More"].isSelected)
    }
    #endif

}
