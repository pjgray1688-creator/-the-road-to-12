import XCTest

@MainActor
final class R12NavigationUITests: XCTestCase {
    func testFourTabsAndBackFollowTheDisplayedRoute() {
        let app = XCUIApplication()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.alerts.buttons["Cancel"].waitForExistence(timeout: 2) {
            springboard.alerts.buttons["Cancel"].tap()
        }
        app.launch()
        XCTAssertFalse(app.navigationBars.staticTexts["R12"].exists)
        XCTAssertTrue(app.buttons["Page options"].exists)
        let tabs = app.tabBars
        XCTAssertTrue(tabs.buttons["Home"].waitForExistence(timeout: 30))
        XCTAssertEqual(tabs.buttons.count, 4)
        XCTAssertFalse(tabs.buttons["Coach"].exists)
        assertSelected(tabs.buttons["Home"])
        for title in ["Training", "Progress", "Account", "Home"] {
            let tab = tabs.buttons[title]
            tab.tap()
            assertSelected(tab)
        }
        let back = app.buttons["Go back"]
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        assertSelected(tabs.buttons["Account"])
    }

    private func assertSelected(_ tab: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let selected = NSPredicate(format: "isSelected == true")
        let expectation = XCTNSPredicateExpectation(predicate: selected, object: tab)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 20), .completed, file: file, line: line)
    }
}
