import EventKit
import SwiftUI

// 日历：月历，以及这台设备上日历里选中那天的日程
struct CalendarView: View {
    @State private var date = Date.now
    @State private var events: [EKEvent] = []
    @State private var access: Bool?
    private let store = EKEventStore()

    var body: some View {
        List {
            Section {
                DatePicker("日期", selection: $date, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.locale, Locale(identifier: "zh_CN"))
                    .environment(\.calendar, {
                        var calendar = Calendar(identifier: .gregorian)
                        calendar.firstWeekday = 2
                        return calendar
                    }())
            }
            Section(date.formatted(.dateTime.month().day().weekday(.wide))) {
                if access == false {
                    Text("没有日历的访问权限，可以在系统设置里打开").foregroundStyle(.secondary)
                } else if events.isEmpty {
                    Text("没有日程").foregroundStyle(.secondary)
                }
                ForEach(events, id: \.eventIdentifier) { event in
                    HStack {
                        RoundedRectangle(cornerRadius: 2).fill(Color(cgColor: event.calendar.cgColor)).frame(width: 4)
                        VStack(alignment: .leading) {
                            Text(event.title ?? "")
                            Text(event.isAllDay ? "全天" : "\(event.startDate.formatted(date: .omitted, time: .shortened)) – \(event.endDate.formatted(date: .omitted, time: .shortened))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("日历")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("今天") { date = .now }
            }
        }
        .task(id: date) { await load() }
    }

    private func load() async {
        if access == nil {
            access = EKEventStore.authorizationStatus(for: .event) == .fullAccess ? true : ((try? await store.requestFullAccessToEvents()) ?? false)
        }
        guard access == true else { return }
        let start = Calendar.current.startOfDay(for: date)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
        events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }
    }
}
