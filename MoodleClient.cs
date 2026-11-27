using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace KalugaCampus;

internal record StudyCourse(long Id, string Name, string Code, string Description, decimal? Progress, string[]? Teachers = null);
internal record StudyTask(long Id, long CourseId, string Name, string Kind, long Due, string Description, string Url);
internal record StudyGrade(long CourseId, string Grade);
internal record StudyData(string Name, StudyCourse[] Courses, StudyTask[] Tasks, StudyGrade[] Grades, string[] Warnings,
    string? AccountKey = null);
internal record CourseSection(string Name, string Description, CourseModule[] Modules);
internal record CourseModule(string Name, string Kind, string Description, string Url);
internal class MoodleException(string message) : Exception(message);

internal static class MoodleClient
{
    private const string Site = "https://e-learning.bmstu.ru/kaluga/";
    private static readonly HttpClient Http = new(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false
    }) { Timeout = TimeSpan.FromSeconds(20) };

    public static async Task<JsonElement> GetAcademicCalendarAsync()
    {
        using var response = await Http.GetAsync("https://lks.bmstu.ru/lks-back/api/v1/schedules/current");
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("data").Clone();
    }

    public static async Task<JsonElement> GetGroupScheduleAsync()
    {
        const string url = "https://lks.bmstu.ru/lks-back/api/v1/schedules/groups/815807d8-bc7e-11ee-b32d-df9b99f124c0/public";
        using var response = await Http.GetAsync(url);
        if (!response.IsSuccessStatusCode) throw new MoodleException("Не удалось загрузить расписание из ЛКС.");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStreamAsync());
        return document.RootElement.GetProperty("data").Clone();
    }

    public static async Task<StudyData> GetDashboardAsync(string token)
    {
        var info = await CallAsync(token, "core_webservice_get_site_info");
        var userId = info.Number("userid");
        if (userId <= 0)
            throw new MoodleException("ЭОС не вернула профиль студента.");

        var coursesRequest = CallAsync(token, "core_enrol_get_users_courses", ("userid", userId));
        var assignmentsRequest = TryCallAsync(token, "mod_assign_get_assignments");
        await Task.WhenAll(coursesRequest, assignmentsRequest);

        var courses = (await coursesRequest).Items()
            .Where(item => item.Number("id") > 0)
            .Select(item => new StudyCourse(
                item.Number("id"), Plain(item.Text("fullname")), Plain(item.Text("shortname")),
                Plain(item.Text("summary")), item.Decimal("progress")))
            .ToArray();
        var courseIds = courses.Select(course => course.Id).ToHashSet();
        var assignments = await assignmentsRequest;
        var tasks = assignments.Get("courses").Items()
            .Where(course => courseIds.Contains(course.Number("id")))
            .SelectMany(course => course.Get("assignments").Items()
                .Where(item => item.Number("id") > 0 && item.Number("cmid") > 0)
                .Select(item => new StudyTask(
                    item.Number("id"), course.Number("id"), Plain(item.Text("name")), "Задание",
                    item.Number("duedate"), Plain(item.Text("intro")),
                    $"{Site}mod/assign/view.php?id={item.Number("cmid")}")))
            .ToArray();
        List<string> warnings = [];
        if (!assignments.Has("courses") || assignments.Get("warnings").Items().Any())
            warnings.Add("ЭОС не предоставила часть заданий или весь список.");
        var name = string.Join(" ", new[] { info.Text("lastname"), info.Text("firstname").Split(' ')[0] }.Where(value => value.Length > 0));
        if (name.Length == 0) name = Plain(info.Text("fullname"));
        return new StudyData(name, courses, tasks, [], warnings.ToArray(),
            userId.ToString(CultureInfo.InvariantCulture));
    }

    public static async Task<CourseSection[]> GetCourseAsync(string token, long courseId)
    {
        if (courseId <= 0)
            throw new MoodleException("Курс не найден.");

        var data = await CallAsync(token, "core_course_get_contents", ("courseid", courseId));
        return data.Items().Where(section => section.Number("visible") != 0 || !section.Has("visible"))
            .Select(section => new CourseSection(
                Plain(section.Text("name")), Plain(section.Text("summary")),
                section.Get("modules").Items()
                    .Where(item => item.Get("uservisible").ValueKind != JsonValueKind.False)
                    .Select(item => new CourseModule(Plain(item.Text("name")), item.Text("modname"),
                        Plain(item.Text("description")), item.Text("url")))
                    .ToArray()))
            .ToArray();
    }

    public static async Task<string> GetSubmissionAsync(string token, long assignmentId)
    {
        if (assignmentId <= 0)
            throw new MoodleException("Задание не найдено.");

        var data = await CallAsync(token, "mod_assign_get_submission_status", ("assignid", assignmentId));
        var attempt = data.Get("lastattempt");
        if (attempt.Text("gradingstatus") == "graded")
            return "Оценено";

        var status = attempt.Get("submission").Text("status");
        if (status.Length == 0)
            status = attempt.Get("teamsubmission").Text("status");
        return status switch
        {
            "submitted" => "Сдано",
            "draft" => "Черновик",
            "new" or "reopened" => "Ожидает отправки",
            _ => "Статус доступен в ЭОС"
        };
    }

    private static async Task<JsonElement> TryCallAsync(
        string token, string function, params (string Key, long Value)[] arguments)
    {
        try
        {
            return await CallAsync(token, function, arguments);
        }
        catch (Exception ex) when (ex is MoodleException or HttpRequestException or OperationCanceledException)
        {
            return default;
        }
    }

    private static async Task<JsonElement> CallAsync(
        string token, string function, params (string Key, long Value)[] arguments)
    {
        var fields = new Dictionary<string, string>
        {
            ["wstoken"] = token,
            ["wsfunction"] = function,
            ["moodlewsrestformat"] = "json"
        };
        foreach (var (key, value) in arguments)
            fields[key] = value.ToString(CultureInfo.InvariantCulture);

        using var content = new FormUrlEncodedContent(fields);
        using var response = await Http.PostAsync(Site + "webservice/rest/server.php", content);
        var status = (int)response.StatusCode;
        if (status is >= 300 and < 500)
            throw new MoodleException("REST-сервис ЭОС недоступен. Проверьте, включён ли доступ для вашей учётной записи.");
        response.EnsureSuccessStatusCode();

        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync();
            using var json = await JsonDocument.ParseAsync(stream);
            var data = json.RootElement;
            if (data.Has("exception") || data.Has("errorcode"))
            {
                var error = data.Text("errorcode");
                throw new MoodleException(error == "invalidtoken"
                    ? "ЭОС отклонила токен. Проверьте токен и срок его действия."
                    : "ЭОС не разрешила этот запрос. Проверьте функции, доступные для токена.");
            }
            return data.Clone();
        }
        catch (JsonException)
        {
            throw new MoodleException("ЭОС вернула веб-страницу вместо ответа API.");
        }
    }

    private static string Plain(string html)
    {
        var withBreaks = Regex.Replace(html, @"</(?:p|li|div|h[1-6])\s*>|<br\s*/?>", "\n", RegexOptions.IgnoreCase);
        return WebUtility.HtmlDecode(Regex.Replace(withBreaks, "<[^>]*>", "")).Trim();
    }
}

internal static class JsonFields
{
    public static JsonElement Get(this JsonElement value, string property) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(property, out var field) ? field : default;

    public static bool Has(this JsonElement value, string property) =>
        value.Get(property).ValueKind != JsonValueKind.Undefined;

    public static IEnumerable<JsonElement> Items(this JsonElement value) =>
        value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : Enumerable.Empty<JsonElement>();

    public static string Text(this JsonElement value, string property) =>
        value.Get(property) is { ValueKind: JsonValueKind.String } field ? field.GetString() ?? "" : "";

    public static long Number(this JsonElement value, string property) =>
        value.Get(property) is { ValueKind: JsonValueKind.Number } field && field.TryGetInt64(out var number) ? number : 0;

    public static decimal? Decimal(this JsonElement value, string property) =>
        value.Get(property) is { ValueKind: JsonValueKind.Number } field && field.TryGetDecimal(out var number) ? number : null;
}
